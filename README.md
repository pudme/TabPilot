# Smart Tab & Window Organizer (TabPilot)

A Chrome extension designed to combat tab sprawl and keep your browsing focused by automatically organizing tabs based on user-defined patterns and providing quick management tools.

## Problem

As we juggle multiple projects, research tasks, and online activities, browser tabs can quickly multiply, leading to clutter, difficulty finding relevant information, and reduced focus. Manually organizing tabs into groups is tedious and often temporary.

## Solution

This extension offers a smarter way to manage your tabs:

*   **Automatic Grouping:** Define patterns (keywords or URL parts like `github.com` or `Project X`) and associate them with group titles and colors. The extension automatically groups new or updated tabs that match these patterns.
*   **Archive & Restore:** Declutter your window without losing context. Archive entire tab groups with a single click, saving their details (title, color, tab URLs). Restore archived groups later to reopen all their tabs instantly.
*   **Quick Switching:** Quickly jump back to the most recently used tab within an active group directly from the extension popup.
*   **Simple Management:** View active and archived groups in the popup. Manage your grouping patterns easily through the extension's options page.

## Features

*   **Pattern-Based Auto-Grouping:**
    *   Configure rules in the Options page based on keywords or URL fragments.
    *   Assign custom titles and colors (grey, blue, red, yellow, green, pink, purple, cyan) to your groups.
    *   Tabs matching a pattern are automatically moved into the corresponding group (new or existing).
*   **Popup Interface:**
    *   View a list of currently active tab groups in the window.
    *   See the number of tabs in each active group.
    *   "Switch" button to jump to the last active tab within a group.
    *   "Archive" button to save the group's tabs and close them.
    *   View a list of archived groups, sorted by recency.
    *   "Restore" button to reopen an archived group and its tabs.
    *   "Delete" button to permanently remove an archived group entry.
*   **Options Page:**
    *   Add new grouping patterns (keyword/URL part, group title, color).
    *   View and remove existing patterns.
    *   Changes are saved automatically and reflected in the background grouping logic.
*   **Storage:**
    *   Grouping patterns are saved using `chrome.storage.sync` (shared across devices if sync is enabled).
    *   Archived group data is saved using `chrome.storage.sync`.
    *   Last active tab information per group is temporarily stored using `chrome.storage.session` (cleared when the browser closes).

## Installation (Development)

1.  Clone or download this repository.
2.  Open Chrome and navigate to `chrome://extensions`.
3.  Enable "Developer mode" using the toggle switch in the top-right corner.
4.  Click the "Load unpacked" button.
5.  Select the directory containing the extension's code (the folder with `manifest.json`).
6.  The "Smart Tab & Window Organizer" icon should appear in your toolbar.

## Future Ideas

*   More advanced "Next Best Tab" logic (frequency, recency, AI classification).
*   Manual grouping/ungrouping options.
*   Drag-and-drop reordering of patterns or groups.
*   Import/Export of patterns and archives.
*   UI Icons for buttons.
*   Time-based auto-archiving. 