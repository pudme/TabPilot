// Background script for Smart Tab & Window Organizer

console.log("Background script loaded.");

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
    console.log("Loaded patterns from storage:", groupingPatterns);
  } else {
    // Initialize with defaults if nothing is stored
    groupingPatterns = defaultPatterns;
    await chrome.storage.sync.set({ groupingPatterns: defaultPatterns });
    console.log("Initialized storage with default patterns.");
  }
}

// Listener for changes in storage (e.g., updated by options page)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.groupingPatterns) {
    groupingPatterns = changes.groupingPatterns.newValue;
    console.log("Grouping patterns updated:", groupingPatterns);
  }
});

// Initial load
loadPatterns();

// --- Event Listeners ---

// Group tabs when they are created
chrome.tabs.onCreated.addListener(async (tab) => {
  console.log("Tab created:", tab.id, tab.url);
  await maybeGroupTab(tab);
});

// Group tabs when their URL changes (e.g., navigating within a tab)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Check if the URL changed and the tab loading is complete
  if (changeInfo.url && tab.status === 'complete') {
    console.log("Tab updated:", tabId, changeInfo.url);
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
      console.log(`Set last active tab for group ${activatedGroupId} to ${tab.id}`);
    }

    // Collapse other groups in the same window
    const groupsInWindow = await chrome.tabGroups.query({ windowId: activeInfo.windowId });
    const updates = groupsInWindow.map(group => {
      // Collapse the group if it's not the one containing the newly activated tab
      const shouldCollapse = group.id !== activatedGroupId;
      // Only update if the state needs changing to avoid unnecessary updates
      if (group.collapsed !== shouldCollapse) {
          console.log(`Updating group ${group.id} collapsed state to ${shouldCollapse}`);
          return chrome.tabGroups.update(group.id, { collapsed: shouldCollapse });
      } else {
          return Promise.resolve(); // No update needed
      }
    });
    await Promise.allSettled(updates); // Wait for all updates to settle

  } catch (error) {
    if (error.message.includes("No tab with id")) {
        console.warn(`Tab ${activeInfo.tabId} not found during onActivated listener.`);
    } else if (error.message.includes("No group with id")) {
        // This might happen if a group is removed concurrently
        console.warn("Attempted to update a non-existent group during collapse logic.");
    } else {
        console.error("Error in tabs.onActivated listener:", error);
    }
  }
});

// Optional: Clean up storage when a group is removed
chrome.tabGroups.onRemoved.addListener(async (group) => {
    const storageKey = `${LAST_ACTIVE_TAB_KEY_PREFIX}${group.id}`;
    await chrome.storage.session.remove(storageKey);
    console.log(`Cleaned up session storage for removed group ${group.id}`);
});

// --- Message Listener ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "restoreGroup") {
    console.log("Received restore request for:", message.groupData);
    (async () => {
      try {
        await handleRestoreGroup(message.groupData);
      } catch (error) {
        console.error("Error handling restoreGroup message:", error);
      }
    })();
  } else if (message.action === "clearStaleSwitchData") {
      console.log("Received request to clear stale switch data for key:", message.storageKey);
      if (message.storageKey && message.storageKey.startsWith(LAST_ACTIVE_TAB_KEY_PREFIX)) {
          (async () => {
              try {
                  await chrome.storage.session.remove(message.storageKey);
                  console.log("Cleared stale session storage key:", message.storageKey);
              } catch (error) {
                  console.error("Error clearing stale session storage:", error);
              }
          })();
      } else {
          console.warn("Ignoring clearStaleSwitchData request with invalid key:", message.storageKey);
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
    console.log(`Tab ${tab.id} matches rule: ${matchingRule.groupTitle}`);
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
    console.log(`Adding tab ${tab.id} to existing group ${groupId} ('${rule.groupTitle}')`);
    try {
      await chrome.tabs.group({ tabIds: [tab.id], groupId: groupId });
    } catch (error) {
        // Handle potential errors if the group doesn't exist anymore (race condition)
        if (error.message.includes("No group with id")) {
            console.warn(`Group ${groupId} not found, creating a new one.`);
            groupId = await createNewGroup(tab, rule);
        } else {
            console.error("Error adding tab to group:", error);
        }
    }

  } else {
    // Create a new group if none exists
    console.log(`Creating new group '${rule.groupTitle}' for tab ${tab.id}`);
    groupId = await createNewGroup(tab, rule);
  }

  // Optionally update the group's color (if not already set or needs changing)
  if (groupId && rule.color) {
    try {
        await chrome.tabGroups.update(groupId, { color: rule.color });
    } catch (error) {
        console.error("Error updating group color:", error);
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
    console.warn("Restore request received with invalid data:", groupData);
    return;
  }

  // 1. Attempt to create all tabs (inactive)
  console.log("Attempting to create tabs for restoration (inactive)...");
  const createPromises = groupData.tabUrls.map(url => {
      if (url && typeof url === 'string' && (url.startsWith('http:') || url.startsWith('https:'))) {
          return chrome.tabs.create({ url: url, active: false });
      } else {
          console.warn(`Skipping invalid or non-HTTP(S) URL during restore: ${url}`);
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
  console.log("Successfully created tabs:", tabIds);

  if (tabIds.length === 0) {
      console.warn("Failed to create any tabs for restoration. Aborting group creation.");
      return;
  }

  // *** NEW: Discard newly created tabs ***
  console.log("Attempting to discard newly created tabs...");
  const discardPromises = tabIds.map(id => chrome.tabs.discard(id).catch(err => {
      // discard can fail if the tab is already discarded or not yet discardable
      console.warn(`Could not discard tab ${id}: ${err.message}`);
  }));
  await Promise.allSettled(discardPromises);
  console.log("Finished attempting to discard tabs.");
  // *** END NEW ***

  // 2. Group the successfully created tabs
  console.log("Grouping new tabs...");
  try {
      const windowId = createdTabs[0].windowId;
      // Optionally create the group collapsed initially
      const newGroupId = await chrome.tabs.group({
          tabIds: tabIds,
          createProperties: { windowId: windowId }
      });
      console.log("Created group:", newGroupId);

      // 3. Update group properties (title, color)
      // Make sure group is collapsed after creation if desired
      console.log("Updating group properties (and collapsing)...");
      await chrome.tabGroups.update(newGroupId, {
          title: groupData.title || 'Restored Group',
          color: groupData.color || 'grey',
          collapsed: true // Ensure restored groups start collapsed
      });

      console.log(`Group "${groupData.title}" restored successfully with ${tabIds.length}/${groupData.tabUrls.length} tabs.`);

  } catch (error) {
      console.error("Error during grouping or updating restored group:", error);
  }
}

// TODO: Load patterns from storage (allow user configuration)
// TODO: Implement group management (archive/restore) 