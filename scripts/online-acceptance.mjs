// Explicit administrator online check only. Never download Pages configuration or print credentials.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

if (process.env.SMARTTOOLS_ONLINE_ADMIN !== '1')
  throw new Error('Online admin acceptance requires explicit SMARTTOOLS_ONLINE_ADMIN=1');
const username = process.env.SMARTTOOLS_ONLINE_USER;
const password = process.env.SMARTTOOLS_ONLINE_PASSWORD;
if (!username || !password) throw new Error('Provide SMARTTOOLS_ONLINE_USER and SMARTTOOLS_ONLINE_PASSWORD explicitly');
const base = (process.env.SMARTTOOLS_BASE_URL || 'https://www.303066.xyz').replace(/\/$/, '');
const parsed = new URL(base);
if (parsed.protocol !== 'https:') throw new Error('Online admin checks require HTTPS');
async function request(route, options = {}) {
  const response = await fetch(base + route, { redirect: 'error', ...options });
  assert.match(response.headers.get('content-type') || '', /application\/json/, `Expected JSON: ${route}`);
  return { response, body: await response.json() };
}
const session = await request('/api/v2/auth/session');
assert.equal(session.response.status, 200);
assert.equal(session.body.loggedIn, false);
assert(!Object.hasOwn(session.body, 'usesDefaultPassword'));
assert.equal(session.response.headers.get('cache-control'), 'private, no-store');
const login = await request('/api/v2/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password })
});
assert.equal(login.response.status, 200, 'v2 login failed');
const cookie = (login.response.headers.get('set-cookie') || '').split(';')[0];
assert(cookie.startsWith('auth='), 'signed session cookie missing');
const authenticated = await request('/api/v2/auth/session', { headers: { Cookie: cookie } });
assert.equal(authenticated.body.loggedIn, true);
const document = await request('/api/v2/bookmarks', { headers: { Cookie: cookie } });
assert.equal(document.response.status, 200);
assert.equal(document.response.headers.get('cache-control'), 'private, no-store');
assert.equal(document.body.document?.schemaVersion, 2);
// Never print the document: it may contain Private bookmarks.
for (const route of ['/api/login', '/api/check', '/api/logout', '/api/account/security', '/api/account/change-password', '/api/account/recovery']) {
  const old = await request(route);
  assert.equal(old.response.status, 410);
  assert.equal(old.body.code, 'AUTH_PROTOCOL_RETIRED');
}
const logout = await request('/api/v2/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
assert.equal(logout.response.status, 200);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(base + '/account.html');
  assert.equal(await page.locator('form').count(), 0);
  assert.equal(await page.locator('script').count(), 0);
  await page.goto(base + '/');
  assert.match(await page.locator('body').innerText(), /栖页|书签网站已停用|书签已迁往/);
} finally { await browser.close(); }
console.log('PASS v2 online account endpoints, protected read, retired routes and static guide (no Private content logged)');
