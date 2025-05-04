Privacy Policy for TabPilot Chrome Extension

Last Updated: May 4, 2025

Thank you for using TabPilot! This policy explains what information the TabPilot Chrome Extension collects and how it's used.

Information We Collect:

TabPilot is designed to operate primarily on your local browser. We collect and store the following information solely for the extension's functionality:

1.  User-Defined Grouping Patterns: When you create rules for automatic tab grouping in the extension's Options page (including the pattern keyword/URL part, group title, and color), this configuration data is stored locally using `chrome.storage.sync`. This allows your patterns to be saved and, if you have Chrome sync enabled, potentially synced across your devices.
2.  Archived Tab Group Data: When you use the "Archive" feature, information about the archived group (its title, color, and the URLs of the tabs within it) is stored locally using `chrome.storage.sync`. This allows you to restore these groups later.
3.  Last Active Tab Information (Session): To provide the "Switch" functionality, the ID of the last tab you actively used within each group is temporarily stored using `chrome.storage.session`. This data is cleared when your browser session ends (i.e., when you close Chrome).

How We Use Information:

The information collected is used *exclusively* to provide the core features of TabPilot:

*   Grouping patterns are used by the background script to automatically organize your tabs.
*   Archived group data is used to display the list of archived groups and to restore them when requested.
*   Last active tab information is used to enable the "Switch" button in the popup.

Information Sharing and Storage:

*   No External Servers: TabPilot does **not** send your grouping patterns, archived tab URLs, last active tab data, or any browsing history to any external servers or third parties.
*   Local Storage: All data is stored locally within your Chrome browser's storage mechanisms (`chrome.storage.sync` and `chrome.storage.session`). `chrome.storage.sync` data *may* be synced by Google if you have enabled Chrome sync in your browser settings, but this data is not directly accessible by the developer ("pudme").

Permissions:

TabPilot requires the following Chrome permissions to function:

*   `tabs`: To access tab URLs and titles for grouping, to group/ungroup tabs, and to switch between tabs.
*   `tabGroups`: To create, modify (title, color, collapsed state), and query tab groups.
*   `storage`: To save and retrieve your grouping patterns and archived group data (`sync`) and last active tab data (`session`).

Changes to This Policy:

We may update this privacy policy from time to time. We will notify you of any significant changes by updating the policy within the extension or its web store listing.

Contact Us:

If you have any questions about this privacy policy, please contact pudme. 