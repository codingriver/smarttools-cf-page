import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.SMARTTOOLS_BASE_URL || 'http://127.0.0.1:8788';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Extension acceptance must run against isolated localhost Pages');
const username = process.env.SMARTTOOLS_TEST_USER || 'testadmin';
const password = process.env.SMARTTOOLS_TEST_PASS || 'TestPass2026';
const executablePath = process.env.EXTENSION_CHROME_PATH || chromium.executablePath();
try { await access(executablePath); } catch { throw new Error('Chromium executable not found. Install the Playwright Chromium browser or set EXTENSION_CHROME_PATH to a compatible Chromium executable.'); }
const original = path.resolve('extensions/open-tabs-importer');
await mkdir('.wrangler', { recursive: true });
const fixtureDir = await mkdtemp(path.resolve('.wrangler/extension-browser-'));
const staged = path.join(fixtureDir, 'extension');
await cp(original, staged, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(original, 'manifest.json'), 'utf8'));
assert.equal(manifest.host_permissions, undefined); assert.equal(manifest.content_scripts, undefined); assert.equal(manifest.chrome_url_overrides, undefined);
assert.deepEqual(manifest.permissions, ['tabs', 'scripting', 'storage', 'contextMenus']);
// Headless Chromium cannot interact with the native optional-host confirmation bubble.
// Pregrant ONLY the isolated test origin in a staged manifest; all extension JS is unchanged.
// Native permission acceptance/rejection still needs a manual real-profile check.
manifest.host_permissions = [new URL(base).origin + '/*'];
await writeFile(path.join(staged, 'manifest.json'), JSON.stringify(manifest, null, 2));
const fixture = [
  { key: 'public', kind: 'card', label: 'Public fixture', visible: true, cards: [{ id: 'one', type: 'simple', title: 'First fixture', url: 'https://example.com', custom: 'preserve-me' }] },
  { key: 'private', kind: 'card', label: 'Private fixture', private: true, visible: true, cards: [{ id: 'secret', type: 'simple', title: 'Private fixture card', url: 'https://example.com/private' }] },
  { key: 'special', kind: 'contact', label: 'Special fixture', cards: [{ title: 'Read-only contact', url: 'mailto:test@example.invalid', custom: 42 }] }
];
async function seed() {
  const login = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0];
  const result = await fetch(base + '/api/save', { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ content: 'var sections = ' + JSON.stringify(fixture) + ';' }) });
  assert.equal(result.status, 200); return cookie;
}
const cookie = await seed();
const context = await chromium.launchPersistentContext(path.join(fixtureDir, 'profile'), {
  executablePath, headless: true, args: [`--disable-extensions-except=${staged}`, `--load-extension=${staged}`]
});
const errors = [];
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host; const homeUrl = `chrome-extension://${id}/home.html`;
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|unsafe-eval/.test(message.text())) errors.push(message.text()); });
  await page.goto(homeUrl); await page.locator('#accountTrigger').click(); assert(await page.locator('#siteUrl').isHidden()); await page.locator('#siteSettings > summary').click(); await page.locator('#siteUrl').fill(base + '/config.html'); await page.locator('#siteForm button').click();
  await page.locator('.group').filter({ hasText: 'Public fixture' }).waitFor().catch(async error => { console.error('Initial load status:', await page.locator('#status').innerText(), errors); throw error; });
  assert.equal(await page.locator('.group').filter({ hasText: 'Private fixture' }).count(), 0);
  await page.locator('#username').fill(username); await page.locator('#password').fill(password); await page.locator('#loginForm button').click();
  await page.locator('#logout:not([hidden])').waitFor(); await page.locator('.group').filter({ hasText: 'Private fixture' }).waitFor();
  assert.equal(await page.locator('#password').inputValue(), '');
  assert(await page.locator('#accountAvatar').isVisible());
  assert.equal(await page.locator('#accountLabel').innerText(), '管理员');
  const registered = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  assert.equal(registered.length, 1); assert(registered[0].matches.every(url => url.startsWith(base + '/config')));
  let website = await context.newPage(); await website.goto(base + '/config.html');
  await website.locator('#mainPage:not(.hidden)').waitFor(); // SameSite=Strict shared session, no cookie injection.
  await page.bringToFront();
  await page.locator('#addGroup').click(); await page.locator('[name=label]').fill('New group'); await page.locator('[name=private]').check(); await page.locator('#editForm button[type=submit]').click();
  await page.locator('#addBookmark').click(); await page.locator('[name=title]').fill('Created card'); await page.locator('[name=url]').fill('/relative'); await page.locator('[name=desc]').fill('searchable description'); await page.locator('#editForm button[type=submit]').click();
  await page.locator('.card > .card-heading .card-actions > summary').click(); await page.getByRole('button', { name: '＋ 子卡片', exact: true }).click(); await page.locator('[name=title]').fill('Child needle'); await page.locator('[name=url]').fill('https://example.com/child'); await page.locator('#editForm button[type=submit]').click();
  await page.locator('#search').fill('needle'); assert.equal(await page.locator('.card').count(), 1); assert.equal(await page.getByRole('link', { name: 'Child needle', exact: true }).count(), 1); await page.locator('#search').fill('');
  assert.equal(await page.getByRole('link', { name: 'Created card', exact: true }).getAttribute('href'), base + '/relative');
  // Child edit and ordering, preserving the parent card and its unknown fields.
  await page.locator('.card > .subcards > summary').click();
  await page.locator('.subcard .card-actions > summary').click(); await page.locator('.subcard').getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('[name=note]').fill('Edited child note'); await page.locator('#editForm button[type=submit]').click();
  await page.locator('.card > .card-heading .card-actions > summary').click(); await page.getByRole('button', { name: '＋ 子卡片', exact: true }).click(); await page.locator('[name=title]').fill('Second child'); await page.locator('#editForm button[type=submit]').click();
  await page.locator('.card > .subcards > summary').click();
  await page.locator('.subcard').filter({ hasText: 'Second child' }).locator('.card-actions > summary').click(); await page.locator('.subcard').filter({ hasText: 'Second child' }).getByRole('button', { name: '↑', exact: true }).click();
  await page.locator('.card > .subcards > summary').click();
  page.once('dialog', d => d.accept()); await page.locator('.subcard').filter({ hasText: 'Second child' }).locator('.card-actions > summary').click(); await page.locator('.subcard').filter({ hasText: 'Second child' }).getByRole('button', { name: '删除', exact: true }).click();
  await page.screenshot({ path: path.join(fixtureDir, 'management-home.png'), fullPage: true });
  await page.locator('.group-menu > summary').click(); await page.getByRole('button', { name: '↑ 上移', exact: true }).click();
  await page.locator('#save').click(); await page.getByRole('status').filter({ hasText: '已保存到云端' }).waitFor();
  let cloud = await (await fetch(base + '/api/data?format=structured', { headers: { Cookie: cookie } })).json();
  assert.equal(cloud.sections.find(s => s.label === 'New group').cards[0].subCards[0].title, 'Child needle');
  assert.equal(cloud.sections.find(s => s.key === 'public').cards[0].custom, 'preserve-me');
  assert.equal(cloud.sections.find(s => s.key === 'special').cards[0].custom, 42);
  let storage = await worker.evaluate(async () => ({ sync: await chrome.storage.sync.get(null), local: await chrome.storage.local.get(null) }));
  assert(!JSON.stringify(storage).includes('Private fixture card')); assert(!JSON.stringify(storage).includes('Child needle'));
  // Move Private -> public: first decline, then accept explicit disclosure warning.
  await page.locator('.card > .card-heading .card-actions > summary').click(); await page.locator('.card > .card-heading .actions').getByRole('button', { name: '移动', exact: true }).click();
  await page.locator('[name=target]').selectOption({ label: 'Public fixture / 顶层 · 公开' });
  page.once('dialog', d => d.dismiss()); await page.locator('#editForm button[type=submit]').click(); assert(await page.locator('#editor').isVisible());
  page.once('dialog', d => d.accept()); await page.locator('#editForm button[type=submit]').click();
  await page.locator('#save').click(); await page.getByRole('status').filter({ hasText: '已保存到云端' }).waitFor();
  // Delete an empty group; delete a nonempty group by explicit migration.
  await page.locator('.group').filter({ hasText: 'New group' }).click();
  await page.locator('.group-menu > summary').click(); await page.getByRole('button', { name: '删除分组', exact: true }).click();
  page.once('dialog', d => d.accept()); await page.locator('#editForm button[type=submit]').click();
  await page.locator('#addGroup').click(); await page.locator('[name=label]').fill('Migrate temporary'); await page.locator('#editForm button[type=submit]').click();
  await page.locator('#addBookmark').click(); await page.locator('[name=title]').fill('Migrated card'); await page.locator('[name=url]').fill('https://example.com/migrated'); await page.locator('#editForm button[type=submit]').click();
  await page.locator('.group-menu > summary').click(); await page.getByRole('button', { name: '删除分组', exact: true }).click(); await page.locator('[name=target]').selectOption('public');
  page.once('dialog', d => d.accept()); await page.locator('#editForm button[type=submit]').click();
  assert.equal(await page.getByRole('link', { name: 'Migrated card', exact: true }).count(), 1);
  // Known offline state blocks writes immediately, retains identity/draft, and needs a recheck.
  await context.setOffline(true);
  await page.waitForFunction(() => document.querySelector('#save').disabled);
  await page.locator('#status.error').waitFor(); assert(await page.locator('#draft').innerText());
  assert.equal(await page.locator('#accountLabel').innerText(), '管理员');
  await context.setOffline(false);
  await page.locator('#accountTrigger').click(); await page.locator('#checkConnection').click();
  await page.waitForFunction(() => !document.querySelector('#save').disabled);
  assert(await page.locator('#draft').innerText()); await page.keyboard.press('Escape');
  await page.locator('#save').click(); await page.getByRole('status').filter({ hasText: '已保存到云端' }).waitFor();
  // Two real clients: a newer server-side group must survive the stale extension save.
  cloud = await (await fetch(base + '/api/data?format=structured', { headers: { Cookie: cookie } })).json();
  cloud.sections.push({ key: 'other_client', kind: 'card', label: 'Other client', cards: [] });
  assert.equal((await fetch(base + '/api/save', { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ content: 'var sections = ' + JSON.stringify(cloud.sections) + ';', baseEtag: cloud.dataEtag }) })).status, 200);
  await page.locator('.group-menu > summary').click(); await page.getByRole('button', { name: '编辑分组', exact: true }).click(); await page.locator('[name=label]').fill('Unsaved conflict draft'); await page.locator('#editForm button[type=submit]').click();
  let saves = 0; page.on('request', request => { if (request.url().endsWith('/api/save')) saves++; });
  await page.locator('#save').click(); await page.getByRole('status').filter({ hasText: '云端数据或数据源已变化' }).waitFor();
  assert.equal(saves, 0); assert(await page.locator('#draft').innerText()); assert.equal(await page.locator('h1').innerText(), 'Unsaved conflict draft');
  const after = await (await fetch(base + '/api/data?format=structured', { headers: { Cookie: cookie } })).json(); assert(after.sections.some(s => s.key === 'other_client'));
  page.once('dialog', d => d.accept()); await page.locator('#refresh').click(); await page.locator('.group').filter({ hasText: 'Other client' }).waitFor();
  // The already-open website holds an older baseline too: no full-save fallback on 409.
  let websiteSaves = 0; website.on('request', request => { if (request.url().endsWith('/api/save')) websiteSaves++; });
  await website.locator('#btnSave').click();
  await website.locator('.toast').filter({ hasText: '云端数据或数据源已变化' }).waitFor();
  assert.equal(websiteSaves, 1); assert(await website.locator('#btnSave').isEnabled());
  // Original active-tab import still reaches website confirmation, not an automatic cloud save.
  const source = await context.newPage(); await source.goto('data:text/html,<title>ignored</title>');
  await source.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Import fixture</title>' }));
  await source.goto('https://example.com/import-fixture');
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  // Popup normally does not become the active browser tab; use current-window batch import in a tab-based harness.
  await popup.locator('#importCurrent').click();
  await website.locator('#openTabsImportModal:not(.hidden)').waitFor();
  assert((await website.locator('#openTabsImportModal').innerText()).includes('Import fixture'));
  // Backend closed: active-page import is staged and delivered after the new config page loads.
  await website.close(); await source.bringToFront();
  const openedBackend = context.waitForEvent('page'); await popup.locator('#importActive').click();
  website = await openedBackend; await website.waitForLoadState();
  await website.locator('#openTabsImportModal:not(.hidden)').waitFor();
  assert((await website.locator('#openTabsImportModal').innerText()).includes('Import fixture'));
  for (let attempt = 0; attempt < 20; attempt++) {
    const pending = await worker.evaluate(() => chrome.storage.local.get('pendingOpenTabsImport'));
    if (!pending.pendingOpenTabsImport) break;
    await page.waitForTimeout(100);
  }
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('pendingOpenTabsImport'))).pendingOpenTabsImport, undefined);
  await page.bringToFront(); await page.locator('#accountTrigger').click(); await page.locator('#logout').click(); await page.locator('#loginForm:not([hidden])').waitFor();
  assert.equal(await page.locator('#accountLabel').innerText(), '登录');
  assert.equal(await page.locator('.group').filter({ hasText: 'Private fixture' }).count(), 1);
  const siteCheck = await website.evaluate(async () => (await (await fetch('/api/check')).json()).loggedIn); assert.equal(siteCheck, false);
  // Login again, expire the browser session, then reactivate the extension page.
  await page.locator('#username').fill(username); await page.locator('#password').fill(password); await page.locator('#loginForm button').click();
  await page.locator('.group').filter({ hasText: 'Private fixture' }).waitFor();
  await context.clearCookies(); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.locator('#loginForm:not([hidden])').waitFor();
  assert.equal(await page.locator('.group').filter({ hasText: 'Private fixture' }).count(), 1);
  assert(await page.locator('#save').isDisabled());
  // Old server / unsupported representation is an explicit error, not an empty editable dataset.
  await worker.evaluate(() => { globalThis.originalFetch = fetch; globalThis.fetch = (url, options) => String(url).endsWith('/api/data?format=structured') ? Promise.resolve(new Response(JSON.stringify({ ok: true, content: 'var sections = [];' }), { headers: { 'Content-Type': 'application/json' } })) : originalFetch(url, options); });
  await page.locator('.cache-menu summary').click();
  page.once('dialog', d => d.accept()); await page.locator('#clearCache').click();
  await page.getByRole('status').filter({ hasText: '本机缓存和草稿已清除' }).waitFor();
  await page.locator('#refresh').click(); await page.getByRole('status').filter({ hasText: '尚不支持结构化数据' }).waitFor();
  assert(await page.locator('#save').isDisabled()); await worker.evaluate(() => { globalThis.fetch = originalFetch; });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, realLoadedMV3Extension: true, nativePermissionPrompt: 'manual; loopback-only pregrant in staged manifest', directLoginAndStrictCookieSessionReuse: true, privateServerIsolationAndLogoutRetention: true, crudSubcardsMoveOrderSearch: true, deleteAndMigrate: true, offlineDraftRetained: true, expiryRetainsPrivateReadOnly: true, oldServerError: true, conflictDraftPreserved: true, websiteConflictDoesNotFallback: true, scopedImportRetained: true, noCspErrors: true, artifactDirectory: fixtureDir }, null, 2));
} finally { await context.close(); }
