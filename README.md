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
