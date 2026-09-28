# SmartTools

SmartTools is a single-theme personal bookmark homepage deployed on Cloudflare Pages. It uses a clean Notion-style frontend and keeps the online admin panel, browser-tab importer extension, full import/export tools, Private sections, KV backups, and a single-admin authentication model.

## Features

- One Notion-style homepage rendered directly at `/` with no theme router.
- Legacy `index1` through `index5` URLs permanently redirect to the homepage.
- `/config.html` manages sections, cards, sub-cards, contacts, and notes.
- Basic Settings can switch sub-card expansion between Classic and the new Directory layout. Directory mode adds site icons with fallbacks, lightweight rows, a sticky Open All toolbar, and bounded internal scrolling; Classic remains the default.
- The Chrome/Edge extension imports open tabs into the admin review workflow.
- Full JSON, `data.js`, CSV, XLSX, browser-bookmark HTML, and ZIP import/export.
- Cloudflare KV storage with manual backup, automatic backup, and restore.
- Single-admin login with an HttpOnly, Secure, SameSite=Strict cookie.
- Account Security can change the administrator password to a salted KV hash and revoke every active session. A temporary Cloudflare one-time recovery token can restore access after a forgotten password.
- Private sections are returned only to the authenticated administrator.

## Private security boundary

Private is server-side access control, not encryption:

- `private: true` sections are stored as plaintext in KV and administrator backups.
- Anonymous `/api/data` responses remove Private sections on the server.
- The authenticated administrator receives and edits the complete data set.
- The homepage may keep public-filtered data in browser localStorage for fast revisits; authenticated administrator responses remain `private, no-store` and are not written to that cache.
- Cloudflare account administrators can still read KV plaintext.
- The public repository's static `data.js` must not contain Private content.
- Build-time snapshots embedded in public HTML are subject to the same boundary. When changing snapshot sources, inlining, or the public allowlist, verify the anonymous response contract and cover rejection of `private`/`no-store` responses, administrator views, and Private content with synthetic tests. This is a maintenance requirement, not a claim that the current release marker checks enforce every rejection case.
- Full exports may contain Private plaintext and must be stored securely.

AES/PBKDF2 encrypted sections and legacy ciphertext compatibility are no longer supported.

## Cloudflare Pages deployment

Build settings:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `/dist` |
| Production branch | `main` |

The build uses an explicit public-file allowlist. Only the homepage, admin page, runtime shared assets, and browser extension are copied to `dist`; README files, tests, package manifests, and other development files are not published as static assets.

Production variables:

| Name | Type | Purpose |
|---|---|---|
| `ADMIN_USER` | Secret/variable | Administrator username |
| `ADMIN_PASS` | Secret | Initial password and final recovery anchor; it is no longer used for daily login after a KV password is set |
| `AUTH_SECRET` | Secret | Cookie HMAC secret, at least 16 characters |
| `PASSWORD_RECOVERY_ENABLED` | Temporary variable | Set to `true` only while the administrator recovery form is needed |
| `PASSWORD_RECOVERY_TOKEN` | Temporary Secret | A unique one-time recovery token of at least 32 characters |

Bind the SmartTools KV namespace as `FAV_KV`. Store `ADMIN_PASS`, `AUTH_SECRET`, and any temporary `PASSWORD_RECOVERY_TOKEN` as encrypted Secrets.

## Administrator password and recovery

The legacy `/api/change-password` endpoint remains removed and returns JSON 404. The existing `/api/account/security`, `/api/account/change-password`, and `/api/account/recovery` endpoints remain part of the single-administrator Account Security module; maintaining them does not restore the legacy endpoint or add multi-user support.

To change the password normally, sign in to `/config.html`, open **Account Security**, enter the current password and a new password of at least 10 characters, and save. SmartTools stores only a random-salt `PBKDF2-SHA-256` hash with 310,000 iterations in KV. Changing the password increments the session version and signs out every device.

Password selection is deterministic: when KV has no custom credential record, login uses Cloudflare `ADMIN_PASS`; after an administrator sets a KV password, only that KV password is accepted. Changing `ADMIN_PASS` does not override an existing KV password.

If the KV password is forgotten:

1. Temporarily add `PASSWORD_RECOVERY_ENABLED=true` and a new `PASSWORD_RECOVERY_TOKEN` of at least 32 random characters to the Cloudflare Pages production variables and secrets.
2. Keep `ADMIN_USER`, `ADMIN_PASS`, `AUTH_SECRET`, and the `FAV_KV` binding configured. `AUTH_SECRET` must be at least 16 characters.
3. Retry the latest production deployment or deploy again so Pages Functions receive the variables.
4. Open `/config.html?recover=1`. Enter the token in the form body and choose a new password. Never place the token in the URL, logs, screenshots, or chat messages.
5. A successful recovery invalidates every old cookie and password and consumes that token permanently.
6. Immediately remove both recovery variables and retry or redeploy. Confirm the login page no longer exposes the recovery action.

Credential hashes and recovery tokens are not included in site settings, bookmark backups, full exports, or public APIs.

## Local development and acceptance

```bash
npm install

npm run build

npx wrangler@latest pages dev dist \
  --kv FAV_KV \
  --binding ADMIN_USER=testadmin \
  --binding ADMIN_PASS=TestPass2026 \
  --binding AUTH_SECRET=0123456789abcdef0123456789abcdef \
  --compatibility-date 2026-07-16 \
  --port 8788

npm test

npm run deploy
```

The acceptance suite covers authentication, salted KV password changes, old-password and old-session invalidation, all-device revocation, one-time recovery tokens, sensitive credential non-disclosure, anonymous write denial, Private isolation, single-theme desktop/mobile rendering, legacy theme redirects, import/export controls, extension assets, backups, notes, and JSON 404 responses for removed APIs.

The browser suite also checks warm-cache reloads, old service worker cache migration, desktop/mobile sub-card layering, offline fallback, and exclusion of private responses from Cache Storage. After building, run `npm run test:cache` to run these isolated cache checks without a local Pages server.

## Project build/release Skill

The repository includes one project-owned Skill: `.agents/skills/smarttools-release/SKILL.md`. Agents can use `$smarttools-release` or follow the reference in `AGENTS.md` for build, release-preparation, and explicitly requested deployment tasks.

- **Build only:** generate local output; never deploy implicitly. The default build may fetch a public snapshot and icons. Disabling the snapshot is useful locally but does not satisfy production release checks.
- **Release preparation:** build, run `npm run verify:deploy`, and select local acceptance checks by change scope; do not upload.
- **Deploy:** only when explicitly requested, update the existing `smarttools` Cloudflare Pages project, including Pages Functions. Verify the account and production branch (`main` in the current script). Do not automatically create a Pages project, standalone Worker, or KV namespace, or change secrets, bindings, or domains.

`npm run deploy` rebuilds before validation and upload, so it does not guarantee byte-for-byte identity with an earlier tested build. The API acceptance suite writes fixtures and must target isolated local data. `npm run test:online` reads remote administrator configuration and logs in; it requires an explicit request for administrator online acceptance, rather than running as an anonymous post-deploy check. Skill files and agent instructions are not public deployment assets.

## API

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| POST | `/api/login` | No | Administrator login |
| POST | `/api/logout` | No | Clear session |
| GET/POST | `/api/account/security` | Admin | Read the password source or revoke every session |
| POST | `/api/account/change-password` | Admin | Verify the current password and set a KV password |
| GET/POST | `/api/account/recovery` | One-time recovery token | Read recovery availability or reset the password once |
| GET | `/api/check` | No | Session and server status |
| GET | `/api/data` | Optional | Public data for visitors, full data for admin |
| GET | `/api/data-meta` | Optional | Visible data hash and ETag |
| POST | `/api/save` | Admin | Full or section-delta save |
| POST | `/api/comment` | Admin | Patch a card note |
| GET/POST | `/api/source` | POST admin | Read or switch KV/static source |
| GET/POST | `/api/site-config` | POST admin | Site, sub-card layout, and backup settings |
| GET/POST/DELETE | `/api/backups` | Admin | Backup, restore, and delete |
| POST | `/api/fetch-page-title` | Admin | Fetch a page title |

Unknown `/api/*` routes return a JSON 404 response.

Anonymous `/api/data` JavaScript responses are cacheable for long-lived public browsing. The homepage renders any safe public local cache first, then revalidates in the background; administrator responses keep no-store semantics.

Homepage HTML (`/` and `/index.html`) revalidates on each online navigation, including ordinary reloads. The service worker uses network-first HTML with an offline fallback and removes old SmartTools cache versions when it activates; fingerprinted shared assets remain long-lived. This prevents cached HTML with outdated inline CSS/JS from bringing back fixed layout bugs. Only public responses are stored; API/admin responses are excluded (except public icon images).


### Extension management homepage (v1.2.0)

`extensions/open-tabs-importer/` now includes an independent, locally packaged bookmark management page. Load that directory as an unpacked MV3 extension, configure your SmartTools HTTPS backend, grant access to that site and open **书签管理**. It does not override new tabs or access Chrome's native bookmarks. The original current-page/window/all-window imports, copy and export flows remain available.

The manager (`home.html`) reuses the single administrator login and browser-managed HttpOnly/Secure/SameSite=Strict session. It supports search, group/card/subcard CRUD, move/order, Private and hidden groups, explicit cloud saves and unsaved-change reminders. Unsupported special card types stay intact/read-only; advanced settings and backups remain in the website backend. No KV means read-only; first static-to-KV save requires explicit full initialization. No extension framework, remote script or eval is required.

- `GET /api/data?format=structured`: actual JSON `sections`, source/configured, dataVersion/dataEtag/dataHash, hasKV, privateFiltered and siteConfig. Parses data literals without executing JavaScript; unsupported data returns 422 `UNSUPPORTED_DATA`. Anonymous output filters Private; administrator JSON uses `private, no-store`. Existing JavaScript and `format=json` contracts remain available.
- `POST /api/save`: website and extension now send `baseEtag` and `baseSource`. An observed stale data/source baseline returns 409 `SAVE_CONFLICT` **before delta writes**, retaining the client's draft with no automatic full-save retry. Delta saves against static/fallback data return 409 `INITIALIZATION_REQUIRED`. Legacy callers without preconditions remain compatible but do not receive stale-write protection. Cloudflare KV is eventually consistent: this is not an atomic CAS/transaction; avoid simultaneous saves from multiple clients.
- Save failure handling: section deltas are prepared in memory and persisted once, avoiding duplicate writes to the same KV keys within a single save. Storage failures return JSON `503 / SAVE_STORAGE_ERROR` with `outcomeUnknown: true`; this is not a transaction or cross-request rate-limit guarantee. Only confirmed authentication failures clear extension login state. Network timeouts, gateway 403/5xx responses and site-permission loss instead retain the draft and last verified identity while disabling edits/saves. The account panel offers a connection/cloud recheck that preserves drafts. Errors identify the endpoint/status without logging credentials or bookmark contents; uncertain writes are never automatically retried.

- Permissions: tabs/scripting/storage/contextMenus plus optional access to the configured site only; no required all-sites host grant, static all-page content script, cookies/bookmarks/history permission. Site URL uses browser sync storage; pending imports use local storage. Complete administrator bookmarks, including Private, are stored per site in extension-origin IndexedDB and shared by the homepage and context menus. There is no proactive expiry or browser-account synchronization of this cache; it is not encrypted. Logout, session expiry, offline use and permission revocation retain a readable local copy, which the server cannot revoke. Separate current-site/all-sites clear controls erase cached data and affected open-page drafts. Uninstalling, browser cleanup or storage failure can lose this cache. Passwords and Cookie tokens are never persisted; unsaved drafts remain in each page’s memory. Logout also affects the same-site website session. Strict browser Cookie policies may require continuing in the website backend, not weakening Cookie flags.

Tests: `npm run test:extension-data` (memory-only parser/privacy/conflicts); `npm run test:api` includes these checks; `npm run test:extension` loads the actual MV3 scripts in Chromium against isolated local Pages. Set `EXTENSION_CHROME_PATH` if needed. Headless extension tests pregrant only loopback in a temporary manifest, so native permission approve/deny/revoke and browser-specific third-party Cookie restrictions still need manual checks. See the extension README for installation, scope and privacy details. Research/test artifacts are not added to the public Pages build whitelist; extension runtime files are packaged.

### Extension 1.2.0: shared durable cache and context-menu capture

The management page groups site authorization, login and cache information in a top-right account popover. Signed-out users see “登录” (Log in); signed-in users see an administrator avatar. Open it for session information, site settings, logout, last-sync time and expandable cache controls. Clicking outside or pressing Escape closes the popover; closing also clears any unsent password. Authentication and durable-cache behavior are unchanged.

- Page, link and toolbar-icon menus always offer “Save to SmartTools”: group → standalone card / child of an existing expandable card. With no cache, the menu offers sign-in/load. Private and hidden groups are marked.
- Home/popup render cached data before checking session/version. Login, explicit refresh and changed versions synchronize full data; no polling. Anonymous results cannot replace an administrator cache. Clean pages follow updates; dirty pages retain drafts and show a warning.
- Captures run serially: fresh authenticated data, stable/unique destination validation including Private status, full-URL deduplication at the chosen location, then a version/source-checked delta save. Other locations may contain the same URL. No retry, full-overwrite fallback or offline write queue.
- Static initialization requires confirmation in the manager (`home.html`); no KV means read-only. Badges and the existing popup report results, without a capture window or notification permission.
- `npm run test:extension` loads a real MV3 extension and covers shared caching/menu handlers. Native menu interaction, permission prompts and restrictive third-party Cookie policies still require manual checks. This local extension exception does not weaken anonymous Private filtering, website HTTP/SW caches or public build snapshots.

### Built-in extension browsing and management views

The popup has separate **Open homepage** (`start.html`) and **Bookmark management** (`home.html`) entries. The homepage is an iTab-style standard icon desktop: a narrow category sidebar, centered clock/date and local-only search, 60px bookmark icons and single-level folder popovers. Hidden groups are omitted, including from search; cached Private groups remain readable offline/after logout. Parent links are separate from folders; search results show category/folder paths. Links open new tabs. Special types remain read-only and intact. At 390/320px the desktop uses four/three columns and a category drawer.

On the desktop, use right-click, visible More buttons or Shift+F10 to add/edit/delete bookmarks, folders and groups. Left-button dragging reorders and moves safe leaf bookmarks across groups or into/out of folders. Folders cannot nest; dropping on ordinary bookmarks only reorders. Search disables dragging. Moving Private content to a public group requires confirmation. Nonempty group/folder deletion offers migration/extraction where safe. All edits first enter the current page’s memory draft; **Apply to draft** is not **Save to cloud**. Closing dirty inputs or discarding drafts requires confirmation.

The manager follows Raindrop's light collections/list/right-editor layout: list by default, optional grid, compact collection filters and contextual actions. **Apply to draft** changes only page memory; the dirty-only bar offers **Save to cloud** and **Discard changes**. Unapplied editor input has a close guard. Both pages reuse separate tabs without replacing an open editor.

Both pages and right-click menus share the same per-site confirmed IndexedDB cache; each page has its own memory draft; unsaved edits never appear in another page or the native context menu. Login, site connection and cache controls are in the shared top-right account popover. RPC authorization checks exact extension page URLs and actions; only exact trusted `start.html` and `home.html` pages can request `save`, with server authentication and source/version checks; query-string lookalikes, popup and content scripts cannot save. The desktop stays read-only on static/no-KV data; only the manager can confirm initialization. Offline/session loss retains drafts but disables edits/saves. No new permissions, server API, framework, theme switcher or new-tab override. UI resources are local and the desktop uses system fonts (the existing OFL font/license remains in `fonts/`); reference products' application code and branding are not copied. `DESIGN.md` records the reference contract; research screenshots/test artifacts are excluded from publication.

`npm run test:extension` includes real MV3 dual-page/cache tests, drawer input guards, hidden groups/children/search, and desktop/390/320px evidence. Native permission prompts and OS context-menu interaction remain manual acceptance items. This UI change does not deploy the website or publish the extension.

On both extension pages, the account popover keeps the site address and Save address action inside collapsed-by-default Advanced settings (高级设置). Open it only for initial setup, site changes or revoked permissions; daily sign-in stays directly accessible. Save address requests site access first and persists the address only after permission is granted; denial or cancellation leaves the previous site settings unchanged. Closing the popover collapses these settings without clearing the saved site or permission.
