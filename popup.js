// popup.js - Logic for the extension popup

const groupsListDiv = document.getElementById('groups-list');
const archivedListDiv = document.getElementById('archived-groups-list'); // Get the new div
const statusDiv = document.getElementById('status');

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

async function switchToTab(tabId, windowId) {
    try {
        // Check if the tab still exists before trying to switch
        await chrome.tabs.get(tabId);
        
        // Switch window focus first (if necessary)
        const currentWindow = await chrome.windows.getCurrent();
        if (currentWindow.id !== windowId) {
            await chrome.windows.update(windowId, { focused: true });
        }
        // Then activate the tab
        await chrome.tabs.update(tabId, { active: true });
        // Close the popup after switching
        window.close(); 
    } catch (error) {
        console.error("Error switching to tab:", error);
        if (error.message.includes("No tab with id")) {
            displayStatus("Cannot switch: Tab no longer exists.", true);
            // TODO: Optionally remove the stale session storage key here
        } else if (error.message.includes("No window with id")) {
             displayStatus("Cannot switch: Window no longer exists.", true);
             // TODO: Optionally remove the stale session storage key here
        } else {
             displayStatus(`Error switching tab: ${error.message}`, true);
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

async function loadGroups() {
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
            for (const group of groups) { // Use for...of for async inside loop
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
                    switchButton.addEventListener('click', () => switchToTab(lastActiveTabId, group.windowId));
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
document.addEventListener('DOMContentLoaded', loadGroups);