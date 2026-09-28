# Permission Justification — SmartTools Tabs Importer 1.2.0

SmartTools is self-hosted. The extension imports open tabs and provides an independent bookmark management page for the user's configured SmartTools instance.

## Required permissions
- `tabs`: read titles, URLs and favicon URLs when the user imports/copies/exports tabs; locate the configured backend and reuse the extension homepage. No history API is used.
- `scripting`: deliver the import handshake to the configured backend and dynamically register `pending-import.js` there.
- `storage`: store the configured URL in `chrome.storage.sync` and pending import payloads in `chrome.storage.local` until acknowledged, plus per-site selected-group UI preferences. No password or authentication token is persisted. Full datasets use extension-origin IndexedDB, NOT chrome.storage.local.

- `contextMenus`: show group/card destinations for explicit page/link/toolbar captures. No alarms, unlimitedStorage, bookmarks, cookies or notifications permission.

## Optional host permissions

`https://*/*` and `http://*/*` are optional declaration ranges, not blanket grants. A user gesture requests only the configured origin (`origin/*`). Production connections require HTTPS; local HTTP is allowed for testing. There is no required `<all_urls>` and no static all-sites content script. Only the current configured backend path (including `/config` and `/config.html` aliases) receives the dynamically registered script. Previous grants can be revoked in browser extension settings.

Runtime site permission is supported for both extension-page API requests and scoped script injection. The previous statement that dynamic permission could not support injection was incorrect and no longer applies.

## Authentication and management

Requests originate in the extension service worker through a fixed-purpose RPC restricted to exact page/action allowlists (home.html, start.html, popup.html; only exact start.html/home.html can request authenticated, version-checked saves; only home.html can initialize static data) and target only the configured site's fixed API paths. Login credentials are sent to that site using its existing login endpoint, not to a third-party account service. HttpOnly, Secure, SameSite=Strict session cookies are managed by the browser via `credentials: include`; no `cookies` permission or token copying is used. Private is server-side access control, not encryption.

No `bookmarks`, `history`, or `cookies` permission is requested. The extension does not synchronize Chrome bookmarks or replace the new-tab page. Bookmark images may load from configured image URLs, and opening a bookmark contacts its destination; there are no analytics or advertising endpoints.

## Local cache disclosure

Complete administrator bookmarks, including Private, are stored per site in extension-origin IndexedDB and shared by the browsing homepage, manager and context menus. There is no proactive expiry or browser-account synchronization of this cache; it is not encrypted. Logout, session expiry, offline use and permission revocation retain a readable local copy, which the server cannot revoke. Separate current-site/all-sites clear controls erase cached data and affected open-page drafts. Uninstalling, browser cleanup or storage failure can lose this cache. Passwords and Cookie tokens are never persisted; unsaved drafts remain in each page’s memory. Content scripts and websites cannot call the full-cache API.
