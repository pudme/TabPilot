// Background script for Smart Tab & Window Organizer

// --- Configuration ---
let groupingPatterns = []; // Will be loaded from storage

const defaultPatterns = [
  { pattern: "github.com", groupTitle: "GitHub", color: "blue" },
  { pattern: "jira", groupTitle: "Jira Project", color: "red" },
  { pattern: "docs.google.com", groupTitle: "Google Docs", color: "green" },
  { pattern: "figma.com", groupTitle: "Figma Designs", color: "purple" },
];

// Load patterns from storage on startup
async function loadPatterns() {
  const data = await chrome.storage.sync.get('groupingPatterns');
  if (data.groupingPatterns) {
    groupingPatterns = data.groupingPatterns;
  } else {
    // Initialize with defaults if nothing is stored
    groupingPatterns = defaultPatterns;
    await chrome.storage.sync.set({ groupingPatterns: defaultPatterns });
  }
}

// Listener for changes in storage (e.g., updated by options page)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.groupingPatterns) {
    groupingPatterns = changes.groupingPatterns.newValue;
  }
});

// Initial load
loadPatterns();

// --- Event Listeners ---

// Group tabs when they are created
chrome.tabs.onCreated.addListener(async (tab) => {
  await maybeGroupTab(tab);
});

// Group tabs when their URL changes (e.g., navigating within a tab)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Check if the URL changed and the tab loading is complete
  if (changeInfo.url && tab.status === 'complete') {
    await maybeGroupTab(tab);
  }
});

// --- Track Last Active Tab per Group & Handle Group Collapse ---

const LAST_ACTIVE_TAB_KEY_PREFIX = 'lastActiveTab_';

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // activeInfo contains tabId and windowId
  let activatedGroupId = chrome.tabGroups.TAB_GROUP_ID_NONE; 
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    activatedGroupId = tab.groupId; // May be TAB_GROUP_ID_NONE or a valid group ID

    // Store last active tab for the group (if applicable)
    if (activatedGroupId && activatedGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      const storageKey = `${LAST_ACTIVE_TAB_KEY_PREFIX}${activatedGroupId}`;
      await chrome.storage.session.set({ [storageKey]: tab.id });
    }

    // Collapse other groups in the same window
    const groupsInWindow = await chrome.tabGroups.query({ windowId: activeInfo.windowId });
    const updates = groupsInWindow.map(group => {
      // Collapse the group if it's not the one containing the newly activated tab
      const shouldCollapse = group.id !== activatedGroupId;
      // Only update if the state needs changing to avoid unnecessary updates
      if (group.collapsed !== shouldCollapse) {
          return chrome.tabGroups.update(group.id, { collapsed: shouldCollapse });
      } else {
          return Promise.resolve(); // No update needed
      }
    });
    await Promise.allSettled(updates); // Wait for all updates to settle

  } catch (error) {
    if (error.message.includes("No tab with id")) {
    } else if (error.message.includes("No group with id")) {
        // This might happen if a group is removed concurrently
    } else {
        console.error("Error in tabs.onActivated listener:", error);
    }
  }
});

// Optional: Clean up storage when a group is removed
chrome.tabGroups.onRemoved.addListener(async (group) => {
    const storageKey = `${LAST_ACTIVE_TAB_KEY_PREFIX}${group.id}`;
    await chrome.storage.session.remove(storageKey);
});

// --- Message Listener ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "restoreGroup") {
    (async () => {
      try {
        await handleRestoreGroup(message.groupData);
      } catch (error) {
        console.error("Error handling restoreGroup message:", error);
      }
    })();
  } else if (message.action === "clearStaleSwitchData") {
      if (message.storageKey && message.storageKey.startsWith(LAST_ACTIVE_TAB_KEY_PREFIX)) {
          (async () => {
              try {
                  await chrome.storage.session.remove(message.storageKey);
              } catch (error) {
                  console.error("Error clearing stale session storage:", error);
              }
          })();
      }
  }
});

// --- Core Logic ---

async function maybeGroupTab(tab) {
  // Ignore pinned tabs and tabs that don't have a URL (e.g., chrome://newtab)
  if (!tab.url || tab.pinned || !tab.url.startsWith('http')) {
    return;
  }

  const matchingRule = findMatchingRule(tab);
  if (matchingRule) {
    await groupTab(tab, matchingRule);
  }
}

function findMatchingRule(tab) {
  if (!tab.url) return null;
  const url = tab.url.toLowerCase();
  // const title = tab.title?.toLowerCase() || ''; // Can also match on title

  for (const rule of groupingPatterns) {
    if (url.includes(rule.pattern.toLowerCase())) {
      return rule;
    }
    // Example: Title matching (optional)
    // if (title.includes(rule.pattern.toLowerCase())) {
    //   return rule;
    // }
  }
  return null;
}

async function groupTab(tab, rule) {
  // Find existing groups with the target title
  const existingGroups = await chrome.tabGroups.query({ title: rule.groupTitle, windowId: tab.windowId });

  let groupId;
  if (existingGroups.length > 0) {
    // Add tab to the first existing group found
    groupId = existingGroups[0].id;
    try {
      await chrome.tabs.group({ tabIds: [tab.id], groupId: groupId });
    } catch (error) {
        // Handle potential errors if the group doesn't exist anymore (race condition)
        if (error.message.includes("No group with id")) {
            groupId = await createNewGroup(tab, rule);
        } else {
            console.error("Error adding tab to group:", error);
        }
    }

  } else {
    // Create a new group if none exists
    groupId = await createNewGroup(tab, rule);
  }

  // Optionally update the group's color (if not already set or needs changing)
  if (groupId && rule.color) {
    try {
        await chrome.tabGroups.update(groupId, { color: rule.color });
    } catch (error) {
        // Avoid erroring out just for color update failure
    }
  }
}

async function createNewGroup(tab, rule) {
    try {
        const newGroupId = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId: tab.windowId } });
        await chrome.tabGroups.update(newGroupId, { title: rule.groupTitle, color: rule.color });
        return newGroupId;
    } catch (error) {
        console.error("Error creating new group:", error);
        return null;
    }
}

// --- Restore Logic (called by message listener) ---

async function handleRestoreGroup(groupData) {
  if (!groupData || !groupData.tabUrls || groupData.tabUrls.length === 0) {
    return;
  }

  // 1. Attempt to create all tabs (inactive)
  const createPromises = groupData.tabUrls.map(url => {
      if (url && typeof url === 'string' && (url.startsWith('http:') || url.startsWith('https:'))) {
          return chrome.tabs.create({ url: url, active: false });
      } else {
          return Promise.resolve({ status: 'rejected', reason: 'Invalid URL' });
      }
  });
  const results = await Promise.allSettled(createPromises);

  const createdTabs = [];
  results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
          createdTabs.push(result.value);
      } else {
          console.error(`Failed to create tab for URL: ${groupData.tabUrls[index]}. Reason: ${result.reason}`);
      }
  });

  const tabIds = createdTabs.map(tab => tab.id);

  if (tabIds.length === 0) {
      return;
  }

  // *** NEW: Discard newly created tabs ***
  const discardPromises = tabIds.map(id => chrome.tabs.discard(id).catch(err => {
  }));
  await Promise.allSettled(discardPromises);
  console.log("Finished attempting to discard tabs.");
  // *** END NEW ***

  // 2. Group the successfully created tabs
  try {
      const windowId = createdTabs[0].windowId;
      // Optionally create the group collapsed initially
      const newGroupId = await chrome.tabs.group({
          tabIds: tabIds,
          createProperties: { windowId: windowId }
      });

      // 3. Update group properties (title, color)
      // Make sure group is collapsed after creation if desired
      await chrome.tabGroups.update(newGroupId, {
          title: groupData.title || 'Restored Group',
          color: groupData.color || 'grey',
          collapsed: true // Ensure restored groups start collapsed
      });

  } catch (error) {
      console.error("Error during grouping or updating restored group:", error);
  }
}

// TODO: Load patterns from storage (allow user configuration)
// TODO: Implement group management (archive/restore) 