// popup.js - Logic for the extension popup

const groupsListDiv = document.getElementById('groups-list');
const archivedListDiv = document.getElementById('archived-groups-list'); // Get the new div
const statusDiv = document.getElementById('status');
const groupSelectedButton = document.getElementById('group-selected-button');
const manualGroupOptionsDiv = document.getElementById('manual-group-options');
const selectedTabCountSpan = document.getElementById('selected-tab-count');
const newGroupNameInput = document.getElementById('new-manual-group-name');
const newGroupColorSelect = document.getElementById('manual-group-color');
const existingGroupSelect = document.getElementById('existing-group-select');
const confirmManualGroupButton = document.getElementById('confirm-manual-group');
const cancelManualGroupButton = document.getElementById('cancel-manual-group');

// --- Storage Keys ---
const ARCHIVED_GROUPS_KEY = 'archivedGroups';
const LAST_ACTIVE_TAB_KEY_PREFIX = 'lastActiveTab_'; // Must match background.js

// --- Helper Functions ---
function displayStatus(message, isError = false, isSuccess = false) {
    statusDiv.textContent = message;
    statusDiv.className = ''; // Clear previous classes
    if (isError) {
        statusDiv.classList.add('error');
    } else if (isSuccess) {
        statusDiv.classList.add('success');
    }
    // Clear message faster for success/status, longer for errors
    const duration = isError ? 4000 : 2500;
    setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.className = '';
    }, duration);
}

function formatDateTime(isoString) {
    if (!isoString) return 'N/A';
    try {
        return new Date(isoString).toLocaleString();
    } catch (e) {
        return isoString; // Return original if parsing fails
    }
}

// --- Core Functions ---

async function archiveGroup(groupId, groupTitle, groupColor) {
    displayStatus(`Archiving group "${groupTitle || 'Untitled'}"...`);
    try {
        // 1. Get tabs in the group
        const tabs = await chrome.tabs.query({ groupId: groupId });
        const tabIds = tabs.map(tab => tab.id);
        const tabUrls = tabs.map(tab => tab.url).filter(url => url); // Filter out empty URLs if any

        if (tabIds.length === 0) {
            displayStatus("Cannot archive an empty group.", true);
            // Optionally, just remove the group if it somehow exists but is empty
            // await chrome.tabGroups.remove(groupId); // This might error if group doesn't exist
            return;
        }

        // 2. Get existing archives
        const data = await chrome.storage.sync.get(ARCHIVED_GROUPS_KEY);
        const archivedGroups = data[ARCHIVED_GROUPS_KEY] || [];

        // 3. Create new archive entry
        const newArchive = {
            id: `archive_${Date.now()}_${Math.random().toString(16).slice(2)}`, // Simple unique ID
            title: groupTitle || 'Untitled Group',
            color: groupColor || 'grey',
            archivedAt: new Date().toISOString(),
            tabUrls: tabUrls
        };

        // 4. Save updated archives
        archivedGroups.push(newArchive);
        await chrome.storage.sync.set({ [ARCHIVED_GROUPS_KEY]: archivedGroups });

        // 5. Close the tabs (group removes itself)
        await chrome.tabs.remove(tabIds);

        displayStatus(`Group "${newArchive.title}" archived successfully.`, false, true);

        // 6. Refresh the lists
        await loadGroups();
        await loadArchivedGroups();

    } catch (error) {
        console.error("Error archiving group:", error);
        displayStatus(`Error archiving group: ${error.message}`, true);
    }
}

async function deleteArchivedGroup(archiveId) {
    displayStatus('Deleting archive...');
    try {
        const data = await chrome.storage.sync.get(ARCHIVED_GROUPS_KEY);
        let archivedGroups = data[ARCHIVED_GROUPS_KEY] || [];
        
        const initialLength = archivedGroups.length;
        archivedGroups = archivedGroups.filter(group => group.id !== archiveId);

        if (archivedGroups.length < initialLength) {
            await chrome.storage.sync.set({ [ARCHIVED_GROUPS_KEY]: archivedGroups });
            displayStatus('Archive deleted.', false, true);
            await loadArchivedGroups();
        } else {
            displayStatus('Archive not found.', true);
        }
    } catch (error) {
        console.error('Error deleting archive:', error);
        displayStatus(`Error deleting archive: ${error.message}`, true);
    }
}

async function restoreGroup(archive) {
    displayStatus(`Restoring group "${archive.title}"...`);
    try {
        // Send message to background script to handle the actual restore
        await chrome.runtime.sendMessage({ 
            action: "restoreGroup", 
            groupData: archive 
        });
        
        // Optimistically remove from archive list immediately after sending message
        // The background script will handle creating the tabs/group
        await deleteArchivedGroup(archive.id); 
        // Removed redundant status message here as deleteArchivedGroup shows its own

    } catch (error) {
        console.error("Error sending restore message:", error);
        // Check if the error is due to the background script not being ready/connected
        if (error.message.includes("Could not establish connection")) {
            displayStatus("Error: Extension context invalidated. Please reload the extension or reopen the popup.", true);
        } else {
            displayStatus(`Error initiating restore: ${error.message}`, true);
        }
    }
}

async function switchToTab(tabId, windowId, groupId) {
    try {
        // Check if the tab still exists before trying to switch
        // We still need to get the tab to confirm it belongs to the expected window
        const tab = await chrome.tabs.get(tabId);
        if (tab.windowId !== windowId) {
            throw new Error("Tab is in a different window than expected.");
        }

        // Switch window focus first (if necessary)
        const currentWindow = await chrome.windows.getCurrent();
        if (currentWindow.id !== windowId) {
            await chrome.windows.update(windowId, { focused: true });
        }
        // Then activate the tab
        await chrome.tabs.update(tabId, { active: true });
        window.close();
    } catch (error) {
        console.error("Error switching to tab:", error);
        let isStale = false;
        if (error.message.includes("No tab with id") || 
            error.message.includes("Tab not found") || 
            error.message.includes("Invalid tab ID")) 
        {
            displayStatus("Cannot switch: Tab no longer exists.", true);
            isStale = true;
        } else if (error.message.includes("No window with id")) {
             displayStatus("Cannot switch: Window no longer exists.", true);
             isStale = true;
        } else if (error.message.includes("different window")) { // Our custom error
            displayStatus("Cannot switch: Tab moved to a different window.", true);
            isStale = true; // Also treat this as stale for the original group context
        } else {
             displayStatus(`Error switching tab: ${error.message}`, true);
        }

        // If data seems stale, try to clear the session storage key
        if (isStale && groupId) {
            const storageKey = `${LAST_ACTIVE_TAB_KEY_PREFIX}${groupId}`;
            console.log("Sending message to clear stale switch data for key:", storageKey);
            chrome.runtime.sendMessage({ action: "clearStaleSwitchData", storageKey: storageKey });
            // We might want to refresh the popup view after this, but it adds complexity
            // Maybe just rely on the user reopening the popup later
        }
    }
}

async function loadArchivedGroups() {
    const loadingPara = archivedListDiv.querySelector('p');
    try {
        const data = await chrome.storage.sync.get(ARCHIVED_GROUPS_KEY);
        const archivedGroups = data[ARCHIVED_GROUPS_KEY] || [];

        // Clear previous content (keep the h2)
        const h2 = archivedListDiv.querySelector('h2');
        archivedListDiv.innerHTML = '';
        if (h2) archivedListDiv.appendChild(h2);

        if (archivedGroups.length === 0) {
            archivedListDiv.insertAdjacentHTML('beforeend', '<p>No archived groups found.</p>');
            return;
        }

        // Sort by most recently archived first
        archivedGroups.sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));

        archivedGroups.forEach(archive => {
            const item = document.createElement('div');
            item.classList.add('archived-item');
            // Use background color to hint at original group color
            // item.style.borderLeft = `5px solid ${archive.color || 'grey'}`;

            const details = document.createElement('div');
            details.classList.add('archived-details');
            const title = archive.title || 'Untitled Group';
            const tabCount = archive.tabUrls.length;
            // Use group color for the dot
            const colorDot = `<span class="color-dot" style="background-color:${archive.color || 'grey'}"></span>`;
            details.innerHTML = `
                <span><strong>${title}</strong> ${colorDot}</span>
                <span>${tabCount} tab${tabCount !== 1 ? 's' : ''}</span>
                <span>Archived: ${formatDateTime(archive.archivedAt)}</span>
            `;

            const actions = document.createElement('div');
            actions.classList.add('archived-actions');

            const restoreButton = document.createElement('button');
            restoreButton.textContent = 'Restore';
            restoreButton.title = 'Reopen this group and its tabs';
            restoreButton.addEventListener('click', () => restoreGroup(archive));

            const deleteButton = document.createElement('button');
            deleteButton.textContent = 'Delete';
            deleteButton.classList.add('delete-button'); // Add class for styling
            deleteButton.title = 'Permanently delete this archive entry';
            deleteButton.addEventListener('click', () => deleteArchivedGroup(archive.id));

            actions.appendChild(restoreButton);
            actions.appendChild(deleteButton);

            item.appendChild(details);
            item.appendChild(actions);
            archivedListDiv.appendChild(item);
        });

    } catch (error) {
        console.error("Error loading archived groups:", error);
        if (loadingPara) loadingPara.remove(); // Remove loading message
        archivedListDiv.insertAdjacentHTML('beforeend', '<p>Error loading archives.</p>');
        displayStatus('Error loading archives.', true);
    }
}

// --- Manual Grouping Functions ---

async function handleGroupSelectedClick() {
    displayStatus("Checking selected tabs...");
    manualGroupOptionsDiv.classList.add('hidden'); // Hide initially
    highlightedTabIds = []; // Reset

    try {
        const highlightedTabs = await chrome.tabs.query({
            highlighted: true,
            currentWindow: true
        });

        // Filter out tabs that are already in any group
        const ungroupedHighlightedTabs = highlightedTabs.filter(tab => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);

        if (ungroupedHighlightedTabs.length < 2) {
            displayStatus("Please select at least 2 ungrouped tabs to create a group.", true);
            return;
        }

        highlightedTabIds = ungroupedHighlightedTabs.map(tab => tab.id);
        selectedTabCountSpan.textContent = highlightedTabIds.length;

        // Populate existing groups dropdown
        const activeGroups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
        existingGroupSelect.innerHTML = '<option value="">-- Select Existing Group --</option>'; // Reset
        activeGroups.sort((a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled'));
        activeGroups.forEach(group => {
            const option = document.createElement('option');
            option.value = group.id;
            option.textContent = group.title || 'Untitled Group';
            existingGroupSelect.appendChild(option);
        });

        // Reset form fields
        newGroupNameInput.value = '';
        newGroupColorSelect.value = 'grey';
        existingGroupSelect.value = ''; // Ensure the default is selected

        // Show the options
        manualGroupOptionsDiv.classList.remove('hidden');
        displayStatus(`Found ${highlightedTabIds.length} selected ungrouped tabs. Choose grouping option.`);

    } catch (error) {
        console.error("Error getting highlighted tabs or active groups:", error);
        displayStatus("Error preparing manual grouping options.", true);
    }
}

async function handleConfirmManualGroup() {
    if (highlightedTabIds.length === 0) {
        displayStatus("No tabs selected for grouping.", true);
        return;
    }

    const existingGroupId = parseInt(existingGroupSelect.value, 10);
    const newGroupName = newGroupNameInput.value.trim();
    const newGroupColor = newGroupColorSelect.value;

    manualGroupOptionsDiv.classList.add('hidden'); // Hide options after clicking confirm
    displayStatus("Grouping tabs...");

    try {
        if (existingGroupId && !isNaN(existingGroupId)) {
            // Add to existing group
            await chrome.tabs.group({ tabIds: highlightedTabIds, groupId: existingGroupId });
            console.log(`Added tabs ${highlightedTabIds} to existing group ${existingGroupId}`);
            displayStatus(`Added ${highlightedTabIds.length} tabs to existing group.`, false, true);
        } else {
            // Create a new group
            const groupOptions = { tabIds: highlightedTabIds };
            // Don't set createProperties if we intend to update title/color immediately after
            // groupOptions.createProperties = { windowId: chrome.windows.WINDOW_ID_CURRENT }; // Assuming current window
            
            const newGroupId = await chrome.tabs.group(groupOptions);
            console.log(`Created new group ${newGroupId} for tabs ${highlightedTabIds}`);

            // Update title and color if specified, or use defaults
            await chrome.tabGroups.update(newGroupId, { 
                title: newGroupName || "New Group", // Default title if none entered
                color: newGroupColor 
            });
            displayStatus(`Created new group with ${highlightedTabIds.length} tabs.`, false, true);
        }

        // Reset state and refresh lists
        highlightedTabIds = [];
        await loadGroups();
        await loadArchivedGroups(); // Refresh archives too, just in case

    } catch (error) {
        console.error("Error performing manual grouping:", error);
        displayStatus(`Error grouping tabs: ${error.message}`, true);
        // Reset state even on error
        highlightedTabIds = [];
    }
}

function handleCancelManualGroup() {
    manualGroupOptionsDiv.classList.add('hidden');
    highlightedTabIds = []; // Clear selection
    displayStatus("Manual grouping cancelled.");
}

async function loadGroups() {
    // Hide manual group options when popup reloads/refreshes
    manualGroupOptionsDiv.classList.add('hidden');
    try {
        // Get active groups in the current window
        const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });

        groupsListDiv.innerHTML = ''; // Clear previous list

        if (groups.length === 0) {
            groupsListDiv.innerHTML = '<p>No active tab groups in this window.</p>';
        } else {
            groups.sort((a, b) => a.title.localeCompare(b.title));

            // Get tabs for counts
            const tabs = await chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
            const tabsByGroupId = {};
            tabs.forEach(tab => {
                if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                    tabsByGroupId[tab.groupId] = (tabsByGroupId[tab.groupId] || []);
                    tabsByGroupId[tab.groupId].push(tab);
                }
            });

            // Get last active tabs for all groups in this window from session storage
            const groupIds = groups.map(g => g.id);
            const storageKeys = groupIds.map(id => `${LAST_ACTIVE_TAB_KEY_PREFIX}${id}`);
            const lastActiveData = await chrome.storage.session.get(storageKeys);

            // Display each active group
            for (const group of groups) {
                const groupElement = document.createElement('div');
                groupElement.classList.add('group-item', `color-${group.color || 'grey'}`);

                const titleElement = document.createElement('div');
                titleElement.classList.add('group-title');
                const groupName = document.createElement('span');
                groupName.textContent = group.title || 'Untitled Group';
                const tabCount = document.createElement('span');
                tabCount.classList.add('tab-count');
                const count = tabsByGroupId[group.id] ? tabsByGroupId[group.id].length : 0;
                tabCount.textContent = `${count} tab${count !== 1 ? 's' : ''}`;
                titleElement.appendChild(groupName);
                titleElement.appendChild(tabCount);
                groupElement.appendChild(titleElement);

                const actionsElement = document.createElement('div');
                actionsElement.classList.add('group-actions'); // Add class

                // Check for last active tab
                const lastActiveTabId = lastActiveData[`${LAST_ACTIVE_TAB_KEY_PREFIX}${group.id}`];
                if (lastActiveTabId) {
                    const switchButton = document.createElement('button');
                    switchButton.textContent = 'Switch';
                    switchButton.title = `Switch to last active tab in "${group.title || 'Untitled'}"`;
                    // Pass groupId to switchToTab
                    switchButton.addEventListener('click', () => switchToTab(lastActiveTabId, group.windowId, group.id)); 
                    actionsElement.appendChild(switchButton);
                }

                const archiveButton = document.createElement('button');
                archiveButton.textContent = 'Archive';
                archiveButton.title = 'Save group and close its tabs';
                archiveButton.addEventListener('click', () => archiveGroup(group.id, group.title, group.color));
                actionsElement.appendChild(archiveButton);

                groupElement.appendChild(actionsElement);
                groupsListDiv.appendChild(groupElement);
            }
        }

    } catch (error) {
        console.error("Error loading groups:", error);
        groupsListDiv.innerHTML = `<p>Error loading groups: ${error.message}</p>`;
        displayStatus("Error loading groups.", true);
    }
    // Finally, load archived groups
    await loadArchivedGroups();
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadGroups(); // Initial load

    // Add new event listeners
    groupSelectedButton.addEventListener('click', handleGroupSelectedClick);
    confirmManualGroupButton.addEventListener('click', handleConfirmManualGroup);
    cancelManualGroupButton.addEventListener('click', handleCancelManualGroup);
});