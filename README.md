# SmartTools

SmartTools is a single-theme personal bookmark homepage deployed on Cloudflare Pages. It uses a clean Notion-style frontend and keeps the online admin panel, browser-tab importer extension, full import/export tools, Private sections, KV backups, and a single-admin authentication model.

## Features

- One Notion-style homepage rendered directly at `/` with no theme router.
- Legacy `index1` through `index5` URLs permanently redirect to the homepage.
- `/config.html` manages sections, cards, sub-cards, contacts, and notes.
- The Chrome/Edge extension imports open tabs into the admin review workflow.
- Full JSON, `data.js`, CSV, XLSX, browser-bookmark HTML, and ZIP import/export.
- Cloudflare KV storage with manual backup, automatic backup, and restore.
- Single-admin login with an HttpOnly, Secure, SameSite=Strict cookie.
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
| `ADMIN_PASS` | Secret | Administrator password |
| `AUTH_SECRET` | Secret | Cookie HMAC secret, at least 16 characters |

Bind the SmartTools KV namespace as `FAV_KV`. `ADMIN_PASS` and `AUTH_SECRET` should be encrypted Secrets.

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

The acceptance suite covers authentication, anonymous write denial, Private isolation, single-theme desktop/mobile rendering, legacy theme redirects, import/export controls, extension assets, backups, notes, and JSON 404 responses for removed APIs.

## API

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| POST | `/api/login` | No | Administrator login |
| POST | `/api/logout` | No | Clear session |
| GET | `/api/check` | No | Session and server status |
| GET | `/api/data` | Optional | Public data for visitors, full data for admin |
| GET | `/api/data-meta` | Optional | Visible data hash and ETag |
| POST | `/api/save` | Admin | Full or section-delta save |
| POST | `/api/comment` | Admin | Patch a card note |
| GET/POST | `/api/source` | POST admin | Read or switch KV/static source |
| GET/POST | `/api/site-config` | POST admin | Site and backup settings |
| GET/POST/DELETE | `/api/backups` | Admin | Backup, restore, and delete |
| POST | `/api/fetch-page-title` | Admin | Fetch a page title |

Unknown `/api/*` routes return a JSON 404 response.

Anonymous `/api/data` JavaScript responses are cacheable for long-lived public browsing. The homepage renders any safe public local cache first, then revalidates in the background; administrator responses keep no-store semantics.
