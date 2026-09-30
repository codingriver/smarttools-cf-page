# SmartTools

SmartTools is a single-theme personal bookmark homepage deployed on Cloudflare Pages. It uses a clean Notion-style frontend and keeps the online admin panel, browser-tab importer extension, full import/export tools, Private sections, KV backups, and a single-admin authentication model.

## Extension-first v2 (implemented, not automatically enabled)

Qiye now uses one canonical `{schemaVersion:2, updatedAt, roots}` document in KV, API responses, extension IndexedDB and page-local drafts. Root folders are categories; nested folders share stable IDs, ordered children, inherited `isPrivate`, and a display-only `visible` flag. Only the server changes the document-level timestamp on effective saves; no-op saves keep the timestamp and ETag. Unknown legacy content is preserved read-only. No new extension permissions or authentication mechanism.

- New admin-only `GET/PUT /api/v2/bookmarks` and `GET /api/v2/bookmarks/meta`; full PUT requires `baseEtag` and returns the confirmed document. Authentication uses v2 login/session/logout; legacy account endpoints are retired (410).
- `BOOKMARKS_MODE` defaults to `legacy`. `maintenance` freezes bookmark APIs (503); `v2` enables the new library and retires old bookmark endpoints (410), keeping `/account.html` as a static server-configuration guide. No implicit KV migration, dual writes, or legacy fallback.
- Stage a reviewed, selected-source administrator export with `npm run prepare:bookmarks-v2 -- <local-file>`. By default it only validates; optional `--output <new-directory-outside-repository>` writes a private backup and candidate, never uploads. The new key is `admin:bookmarks:v2:current`. Initialize only during a separately authorized maintenance cutover; retain frozen old keys until independently approved deletion.
- Match `SMARTTOOLS_BOOKMARKS_MODE` at build time to the server mode. Retirement builds contain no bookmark snapshot. `verify:deploy` requires `SMARTTOOLS_CONFIRMED_SERVER_MODE` for v2/maintenance; this manual assertion does not inspect production. Default legacy production checks remain in force.
- The desktop account menu supports JSON export/import. Export downloads the last confirmed v2 document, including hidden/Private data but not drafts, as an unencrypted file. Import checks size, structure, fields, IDs, depth and safe URLs, then asks before replacing (not merging) the page draft. It requires a verified writable session, keeps the current ETag/confirmed timestamp, and does not update cloud or cache until an explicit save succeeds.
- `npm run test:v2` tests the model/API and retirement builds/warm SW behavior; `npm run test:extension` uses synthetic data and real MV3 pages against an isolated loopback fixture server, with no production login.
- Tab collection/copy/export is not redesigned in this release. The old website-confirmation import buttons are disabled/hidden; a new import workflow is deferred. Native right-click single-link capture uses v2.

See [the complete protocol, storage and maintenance guide](BOOKMARKS_V2.md) and [extension usage](extensions/open-tabs-importer/README.md). This development does not deploy or migrate production. KV remains eventually consistent, not atomic CAS; avoid concurrent writers.

## Legacy website features (`BOOKMARKS_MODE=legacy`)


- One Notion-style homepage rendered directly at `/` with no theme router.
- Legacy `index1` through `index5` URLs permanently redirect to the homepage.
- `/config.html` manages sections, cards, sub-cards, contacts, and notes.
- Basic Settings can switch sub-card expansion between Classic and the new Directory layout. Directory mode adds site icons with fallbacks, lightweight rows, a sticky Open All toolbar, and bounded internal scrolling; Classic remains the default.
- Earlier extension versions could import open tabs into this legacy admin review workflow; the new v2 extension defers that integration.
- Full JSON, `data.js`, CSV, XLSX, browser-bookmark HTML, and ZIP import/export.
- Cloudflare KV storage with manual backup, automatic backup, and restore.
- Single-admin login with an HttpOnly, Secure, SameSite=Strict cookie.
- Online password changes, revocation and recovery are retired; v2 credentials come from Pages environment configuration.
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

Production variables (Cloudflare Pages Functions, not a separate Worker):

| Name | Type | Purpose |
|---|---|---|
| `USER` | Variable/Secret | Administrator username; absent defaults to `admin` |
| `PASSWORD` | Secret | Administrator password; absent defaults to the publicly known `codingriver2026` |
| `AUTH_SECRET` | Secret | Independent HMAC session secret; at least 16 characters; required |

Bind the KV namespace as `FAV_KV`. **Configure a unique `PASSWORD` before production use.** A missing password falls back to a *public, insecure default*; explicitly empty/invalid values are configuration errors and must not fall back. Do not reuse the password as `AUTH_SECRET`. `ADMIN_USER`, `ADMIN_PASS`, KV `admin:credentials`, and recovery settings do not authenticate v2 sessions, even if left configured. No password, cookie token or actual environment secret is stored in extension storage, public assets, or logs.

## Administrator credentials and retired account maintenance

Change credentials by updating `USER` and/or `PASSWORD` in the existing Pages project environment settings and redeploying; then sign in again. Updating either variable or `AUTH_SECRET` invalidates v2 cookies on instances using the new settings. Deploy transitions are not instant global revocation. Old sessions are not accepted by v2, and local Private extension cache is **not** erased when logging out or changing passwords; clear it separately in the extension on shared devices. `/account.html` is a static configuration guide without login or recovery forms. The old login, check, logout and `/api/account/*` endpoints return JSON 410 in every bookmarks mode; `/api/change-password` remains JSON 404. Legacy KV credential records remain stored but are not read by v2; no automatic deletion or migration occurs.

## Local development and acceptance

```bash
npm install

npm run build

npx wrangler@latest pages dev dist \
  --kv FAV_KV \
  --binding USER=testadmin \
  --binding PASSWORD=TestPass2026 \
  --binding AUTH_SECRET=0123456789abcdef0123456789abcdef \
  --compatibility-date 2026-07-16 \
  --port 8788

npm test

npm run deploy
```

The acceptance suite covers v2 authentication, changed-credential session invalidation, old-protocol retirement, sensitive credential non-disclosure, anonymous write denial, Private isolation, single-theme desktop/mobile rendering, legacy theme redirects, import/export controls, extension assets, backups, notes, and JSON 404 responses for removed APIs.

The browser suite also checks warm-cache reloads, old service worker cache migration, desktop/mobile sub-card layering, offline fallback, and exclusion of private responses from Cache Storage. After building, run `npm run test:cache` to run these isolated cache checks without a local Pages server.

## Project build/release Skill

The repository includes one project-owned Skill: `.agents/skills/smarttools-release/SKILL.md`. Agents can use `$smarttools-release` or follow the reference in `AGENTS.md` for build, release-preparation, and explicitly requested deployment tasks.

- **Build only:** generate local output; never deploy implicitly. The default build may fetch a public snapshot and icons. Disabling the snapshot is useful locally but does not satisfy production release checks.
- **Release preparation:** build, run `npm run verify:deploy`, and select local acceptance checks by change scope; do not upload.
- **Deploy:** only when explicitly requested, update the existing `smarttools` Cloudflare Pages project, including Pages Functions. Verify the account and production branch (`main` in the current script). Do not automatically create a Pages project, standalone Worker, or KV namespace, or change secrets, bindings, or domains.

`npm run deploy` rebuilds before validation and upload, so it does not guarantee byte-for-byte identity with an earlier tested build. The API acceptance suite writes fixtures and must target isolated local data. `npm run test:online` requires an explicit request for administrator online acceptance and `SMARTTOOLS_ONLINE_ADMIN=1`, `SMARTTOOLS_ONLINE_USER`, and `SMARTTOOLS_ONLINE_PASSWORD`; it never downloads remote settings, and must not run as an anonymous post-deploy check. Skill files and agent instructions are not public deployment assets.

## API

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| POST | `/api/v2/auth/login` | No | Administrator login with configured/default credentials |
| GET | `/api/v2/auth/session` | No | Session status; authenticated view includes default-password warning flag |
| POST | `/api/v2/auth/logout` | No | Clear current cookie without clearing local extension cache |
| GET/PUT | `/api/v2/bookmarks` | Administrator | Full v2 document read/write, `baseEtag` required on PUT |
| GET | `/api/v2/bookmarks/meta` | Administrator | Version and update timestamp |
| All | `/api/login`, `/api/check`, `/api/logout`, `/api/account/*` | Retired | JSON 410; no compatibility fallback |
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


### Qiye extension homepage

Use the matching v2 server and the single built-in start.html page. Browse nested containers, local path-aware search, edit/move/delete/reorder, reveal hidden containers for organization, and explicitly save memory drafts. Exact trusted homepage messages only; no native-bookmark access or new-tab override. Full Private caches remain readable after logout/offline, without expiry or encryption claims; clear them separately on shared devices. Old caches are read-only until a confirmed v2 sync. Settings, database name and existing sessions are retained.

### Extension sidebar width

Drag the right edge of the Qiye sidebar to resize it; double-click to reset to 180px. Focus the separator and use Left/Right for 8px steps, Shift + Left/Right for 24px, or Home/End for the minimum/maximum. Escape, pointer cancellation or window blur cancels an unfinished drag. At widths of 600px or less, a category drawer replaces the desktop sidebar without changing its preference. Width is stored only in `chrome.storage.local.desktopSidebarWidth` and synchronized between local homepage tabs. A smaller window temporarily clamps the layout; logout, site switching and bookmark-cache clearing do not reset the preference. Resizing needs no login, changes no bookmark drafts and sends nothing to the server. Storage failures retain the current layout and show a warning.
