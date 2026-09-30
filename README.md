# Qiye — Bookmark Desktop (栖页)

This repository contains only a standalone Chrome extension (`extensions/open-tabs-importer/`) and a Cloudflare Pages **v2 API**. There is no longer a web homepage/admin panel, old API, or server-side bookmark backup/recovery. The extension offers a bookmark desktop with explicit draft saves, right-click capture, per-origin IndexedDB cache, manual JSON import/export, and independent popup tab copy/HTML/JSON export. It does not replace new tabs or sync Chrome bookmarks.

## Setup

Bind `FAV_KV` to Pages Functions, set `AUTH_SECRET` (at least 16 characters), and set a **unique `PASSWORD` Secret**. `USER` may override the default username. Missing USER/PASSWORD fall back independently to public `admin` / `codingriver2026`, which is unsafe for an exposed service. Legacy `ADMIN_*` and KV password records are ignored. Changing credentials requires updating deployment variables and redeploying; sign in again.

If the current v2 KV key `admin:bookmarks:v2:current` is absent, use `npm run prepare:bookmarks-v2 -- --empty --output <new-directory-outside-repo>` or `--input <pure-v2-document.json> --output <new-directory-outside-repo>`. The offline tool validates the v2 document and writes `{document,etag}`; it **never uploads or overwrites KV**. Independently check that the target KV is empty before first installation. Routine imports use extension drafts and normal save.

Install `extensions/open-tabs-importer/` as an unpacked Chrome extension, grant access to the configured Pages **origin** in Advanced Settings, and sign in. Previously saved `/config.html` settings normalize to the same origin without clearing v2 cache or permissions.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v2/auth/login` | Set secure session Cookie from `{username,password}` |
| GET | `/api/v2/auth/session` | Session/configuration status |
| POST | `/api/v2/auth/logout` | Clear Cookie |
| GET / PUT | `/api/v2/bookmarks` | Read complete document / save `{baseEtag,document}` |
| GET | `/api/v2/bookmarks/meta` | Current ETag and top-level `updatedAt` |

Administrator responses are `private, no-store`; Cookie is HttpOnly, Secure, SameSite=Strict. A no-op save does not write KV or update ETag/time; a real save writes the **current key exactly once**, without backup or retention. ETag checking is not a cross-node atomic lock (KV is eventually consistent). Conflict, uncertain write, and offline failures leave extension drafts intact. Other paths including old websites and old APIs return JSON 404, and wrong methods on allowed routes return 405.

**No cloud backup/history/recovery.** Existing historical KV backup keys are left untouched but never accessed. Export JSON manually and store it securely if you need historical copies; imports become unsaved drafts before explicit, authenticated saving. Extension IndexedDB caches the last confirmed v2 document, including unencrypted Private data, per origin indefinitely; logout/offline/permission revocation do not clear it. Clear local cache separately. Old v1/sections cache is no longer read; v2 `legacy` nodes remain intact as read-only content. Deleting the old website cannot remotely erase cached pages/SW from previously visiting browsers; manually clear old site data if needed.

## Local checks

`npm run build && npm run verify:deploy && npm test`. The only static Pages output is `dist/_routes.json`; the extension is installed separately. `npm run deploy` uploads only on explicit authorization; this change does not deploy. See [protocol](BOOKMARKS_V2.md) and [extension guide](extensions/open-tabs-importer/README.md).
