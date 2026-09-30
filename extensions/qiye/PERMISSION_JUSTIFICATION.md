# Permission justification — Qiye 1.2.0

- `tabs`: user-initiated current-window/all-window tab title, URL and favicon collection for clipboard and file export; open/reuse the extension homepage. No browser history or native bookmark access.
- `storage`: server origin (`configUrl` compatibility key) in sync storage; selected group/sidebar width UI preferences in local storage. Complete confirmed v2 documents use extension-origin IndexedDB, not chrome.storage.local; passwords and cookies are not persisted.
- `contextMenus`: user-initiated page/link/toolbar bookmark capture into cached category/folder destinations.
- Optional `https://*/*`, `http://*/*`: declarations for on-demand permission requests **only for the chosen origin**. HTTP is allowed only for localhost. Revocation blocks cloud access but does not erase local cache.

There is no `scripting`, `cookies`, `bookmarks`, `history`, notifications, or new-tab override. No content scripts, site injection, or website-confirmation import. Exact sender/action allowlists isolate the bookmark cache from websites and the popup; only exact start.html may save. Cloud requests use fixed v2 API paths with browser-managed HttpOnly/Secure/SameSite=Strict cookies. Private is server-side access control, not encryption; complete Private data remains in IndexedDB until independently cleared. No server-side backup/recovery is provided; users can manually export unencrypted JSON.
