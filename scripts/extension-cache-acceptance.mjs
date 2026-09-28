import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { menuTargets, resolveTarget, appendCapture, captureItem } from '../extensions/open-tabs-importer/menu-model.js';

const base = process.env.SMARTTOOLS_BASE_URL || 'http://127.0.0.1:8788';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Isolated loopback server required');
const alternative = new URL(base); alternative.hostname = alternative.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
const other = alternative.origin;
const username = process.env.SMARTTOOLS_TEST_USER || 'testadmin';
const password = process.env.SMARTTOOLS_TEST_PASS || 'TestPass2026';
const fixture = [
  { key: 'public', label: 'Public cache fixture', kind: 'card', visible: true, cards: [
    { id: 'plain', title: 'Plain', url: 'https://example.invalid/plain', type: 'simple' },
    { id: 'parent', title: 'Expandable fixture', type: 'expandable', subCards: [] },
    { title: 'Fingerprint fixture', type: 'expandable', subCards: [] }
  ] },
  { key: 'private', label: 'Private cache fixture', kind: 'card', private: true, visible: false, cards: [{ id: 'secret', title: 'Synthetic Private card', url: 'https://example.invalid/private' }] },
  { key: 'private_visible', label: 'Visible private fixture', kind: 'card', private: true, cards: [{ id: 'private_visible_card', title: 'Offline Private start fixture', url: 'https://example.invalid/offline-private' }] }
];
assert.equal(menuTargets({ sections: fixture })[0].entries.length, 3);
assert.match(menuTargets({ sections: fixture })[1].title, /🔒.*隐藏/);
assert.throws(() => captureItem({}, { url: 'chrome://extensions' }));
assert.equal(captureItem({ linkUrl: 'https://example.invalid/link#hash' }, { title: 'Wrong page title' }).title, 'https://example.invalid/link#hash');
const parentTarget = menuTargets({ sections: fixture })[0].entries[1].target;
assert.equal(resolveTarget([...fixture].reverse(), parentTarget).parent.id, 'parent');
const fingerprintTarget = menuTargets({ sections: fixture })[0].entries[2].target;
assert.equal(resolveTarget([{ ...fixture[0], cards: [...fixture[0].cards].reverse() }], fingerprintTarget).parent.title, 'Fingerprint fixture');
assert.throws(() => resolveTarget([{ ...fixture[0], cards: [{ ...fixture[0].cards[2], title: 'Changed' }] }], fingerprintTarget));
assert.throws(() => resolveTarget([{ ...fixture[0], cards: [fixture[0].cards[2], fixture[0].cards[2]] }], fingerprintTarget));

assert.throws(() => resolveTarget([{ ...fixture[0], private: true }], parentTarget));
assert.throws(() => resolveTarget([{ ...fixture[0], cards: [fixture[0].cards[1], fixture[0].cards[1]] }], parentTarget));
const clone = structuredClone(fixture);
assert(appendCapture(clone, parentTarget, { url: 'https://example.invalid/a?q=1#x', title: 'A' }, base, 'new'));
assert(!appendCapture(clone, parentTarget, { url: 'https://example.invalid/a?q=1#x', title: 'A' }, base, 'new2'));
assert(appendCapture(clone, parentTarget, { url: 'https://example.invalid/a?q=1#y', title: 'A' }, base, 'new3'));
const login = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie').split(';')[0];
async function cloud() { return (await fetch(base + '/api/data?format=structured', { headers: { Cookie: cookie } })).json(); }
async function seed(sections) {
  const current = await cloud();
  const response = await fetch(base + '/api/save', { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ content: 'var sections = ' + JSON.stringify(sections) + ';', baseEtag: current.dataEtag, baseSource: current.configured }) });
  assert.equal(response.status, 200);
}
await seed(fixture);
await mkdir('.wrangler', { recursive: true });
const directory = await mkdtemp(path.resolve('.wrangler/extension-cache-'));
const staged = path.join(directory, 'extension');
await cp('extensions/open-tabs-importer', staged, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(staged, 'manifest.json'), 'utf8'));
assert.equal(manifest.version, '1.2.0');
assert.deepEqual(manifest.permissions, ['tabs', 'scripting', 'storage', 'contextMenus']);
manifest.host_permissions = [base + '/*', other + '/*'];
await writeFile(path.join(staged, 'manifest.json'), JSON.stringify(manifest));
// Test-only service-worker hooks: production exposes no menu/caching debug RPC.
await appendFile(path.join(staged, 'background.js'), `\nimport { handleMenuClick, rebuildMenus, trustedClient } from './cache-controller.js';\nimport { readMenuIndex, readSnapshot } from './cache-db.js';\nglobalThis.testCache = { handleMenuClick, rebuildMenus, trustedClient, readMenuIndex, readSnapshot };\n`);
const options = { executablePath: process.env.EXTENSION_CHROME_PATH || chromium.executablePath(), headless: true, args: [`--disable-extensions-except=${staged}`, `--load-extension=${staged}`] };
let context;
let worker, page, id;
async function launch() {
  context = await chromium.launchPersistentContext(path.join(directory, 'profile'), options);
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  id = new URL(worker.url()).host;
}
async function rpc(action, extra = {}, target = page, site = base) {
  const result = await target.evaluate(async ({ action, configUrl, extra }) => chrome.runtime.sendMessage({ channel: 'smarttools-client', action, configUrl, ...extra }), { action, configUrl: site + '/config.html', extra });
  if (!result.ok) throw Object.assign(new Error(result.error), { status: result.status });
  return result.value;
}
async function targetId(sectionKey = 'public', parent = null) {
  return worker.evaluate(async ({ sectionKey, parent }) => {
    const index = await testCache.readMenuIndex();
    return Object.entries(index.entries).find(([, value]) => value.sectionKey === sectionKey && (parent ? value.parent?.id === parent : !value.parent))?.[0];
  }, { sectionKey, parent });
}
async function click(menuItemId, url, link = false) {
  await worker.evaluate(async ({ menuItemId, url, link }) => testCache.handleMenuClick({ menuItemId, ...(link ? { linkUrl: url } : {}) }, { url, title: 'Capture fixture' }), { menuItemId, url, link });
  return rpc('status.get');
}
try {
  await launch();
  await worker.evaluate(configUrl => chrome.storage.sync.set({ configUrl }), base + '/config.html');
  page = await context.newPage(); await page.goto(`chrome-extension://${id}/home.html`);
  await page.locator('.group').filter({ hasText: 'Public cache fixture' }).waitFor();
  assert.equal(await rpc('cache.get'), null);
  await worker.evaluate(() => chrome.contextMenus.update('smarttools-root', { enabled: true }));
  await rpc('login', { username, password });
  await page.locator('.group').filter({ hasText: 'Private cache fixture' }).waitFor();
  assert.equal((await rpc('cache.get')).sections[1].private, true);
  const leaked = await worker.evaluate(async () => JSON.stringify({ local: await chrome.storage.local.get(null), sync: await chrome.storage.sync.get(null), session: await chrome.storage.session.get(null) }));
  assert(!leaked.includes('Synthetic Private card'));
  await worker.evaluate(() => { globalThis.realFetch = fetch; globalThis.fullRequests = 0; globalThis.fetch = (url, options) => { if (String(url).endsWith('/api/data?format=structured')) fullRequests++; return realFetch(url, options); }; });
  await rpc('sync'); assert.equal(await worker.evaluate(() => fullRequests), 0);
  const browsing = await context.newPage(); await browsing.goto(`chrome-extension://${id}/start.html`);
  await browsing.getByRole('button', { name: 'Visible private fixture · Private', exact: true }).click();
  await browsing.getByRole('link', { name: 'Offline Private start fixture', exact: true }).waitFor();
  await browsing.getByRole('button', { name: 'Public cache fixture', exact: true }).click();
  // A second real home sees shared updates, but its unsaved draft is never cached.
  const second = await context.newPage(); await second.goto(`chrome-extension://${id}/home.html`);
  await second.locator('#addGroup:not([disabled])').waitFor();
  await second.locator('.group').filter({ hasText: 'Public cache fixture' }).click(); await second.locator('.group-menu > summary').click();
  await second.getByRole('button', { name: '编辑分组', exact: true }).click(); await second.locator('[name=label]').fill('Unsaved local draft'); await second.locator('#editForm button[type=submit]').click();
  assert(!(await rpc('cache.get')).sections.some(s => s.label === 'Unsaved local draft'));
  assert.equal(await browsing.locator('h2').filter({ hasText: 'Unsaved local draft' }).count(), 0);
  let result = await click(await targetId(), 'https://example.invalid/capture?q=1#x'); assert.equal(result.error, false);
  await page.getByRole('link', { name: 'Capture fixture', exact: true }).waitFor();
  await browsing.locator('.tile-title').filter({ hasText: 'Capture fixture' }).waitFor();
  await second.locator('#status').filter({ hasText: '当前草稿保留' }).waitFor();
  assert.equal(await second.locator('h1').innerText(), 'Unsaved local draft');
  await second.locator('#save').click(); await second.locator('#status.error').filter({ hasText: '云端数据或数据源已变化' }).waitFor();
  assert.equal((await cloud()).sections[0].label, 'Public cache fixture');
  second.once('dialog', d => d.accept()); await second.close({ runBeforeUnload: true });
  result = await click(await targetId(), 'https://example.invalid/capture?q=1#x'); assert.match(result.text, /已跳过/);
  result = await click(await targetId('public', 'parent'), 'https://example.invalid/link', true); assert.equal(result.error, false);
  assert.equal((await cloud()).sections[0].cards.find(c => c.id === 'parent').subCards[0].content, 'https://example.invalid/link');
  // Two queued clicks on one menu revision both complete, without lost writes.
  const standalone = await targetId();
  await worker.evaluate(async id => Promise.all(['queue-a', 'queue-b'].map(name => testCache.handleMenuClick({ menuItemId: id }, { url: 'https://example.invalid/' + name, title: name }))), standalone);
  assert.equal((await cloud()).sections[0].cards.filter(c => c.title?.startsWith('queue-')).length, 2);
  // Reordering preserves stable IDs; changing the Private destination rejects stale choices.
  const stale = await targetId('private');
  let latest = await cloud(); latest.sections[1].private = false; await seed(latest.sections);
  result = await click(stale, 'https://example.invalid/not-written'); assert.equal(result.error, true); assert.match(result.text, /收藏位置已变化/);
  assert(!(await cloud()).sections[1].cards.some(c => c.url.includes('not-written')));
  latest.sections[1].private = true; latest.sections[0].cards.reverse(); await seed(latest.sections);
  result = await click(await targetId('public', 'parent'), 'https://example.invalid/reordered'); assert.equal(result.error, false);
  // Real isolated-world content script cannot call the cache channel; no synthetic sender bypass.
  const webPage = await context.newPage(); await webPage.goto(base + '/config.html');
  const denied = await worker.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(new URL(url).origin + '/config'));
    return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => chrome.runtime.sendMessage({ channel: 'smarttools-client', action: 'cache.get' }) }))[0].result;
  }, base + '/config.html');
  assert.equal(denied.status, 403);
  assert.equal(await worker.evaluate(() => testCache.trustedClient({ id: chrome.runtime.id, url: 'https://example.invalid/home.html' })), false);
  await webPage.close();
  // Storage failure aborts only the cache transaction, not the acknowledged cloud write.
  const oldEtag = (await rpc('cache.get')).dataEtag;
  await worker.evaluate(() => { globalThis.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { if (this.name === 'snapshots') { this.transaction.abort(); throw new Error('Synthetic quota failure'); } return originalPut.apply(this, args); }; });
  result = await click(await targetId(), 'https://example.invalid/quota'); assert.match(result.text, /云端已收藏/);
  assert.equal((await rpc('cache.get')).dataEtag, oldEtag);
  assert((await cloud()).sections[0].cards.some(c => c.url?.endsWith('/quota')));
  await worker.evaluate(() => { IDBObjectStore.prototype.put = originalPut; });
  await rpc('sync', { force: true });
  // Guard failures never turn into silent initialization, unauthenticated writes or retry/full overwrite.
  await worker.evaluate(() => {
    globalThis.guardFetch = fetch; globalThis.testMode = ''; globalThis.saveAttempts = 0;
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/api/save')) { saveAttempts++; if (testMode === 'conflict') return new Response(JSON.stringify({ ok: false, error: 'Synthetic conflict' }), { status: 409 }); }
      const response = await guardFetch(url, options);
      if (!String(url).endsWith('/api/data?format=structured') || !testMode || testMode === 'conflict') return response;
      const data = await response.json();
      if (testMode === 'no-kv') data.hasKV = false;
      if (testMode === 'static') data.source = 'static';
      if (testMode === 'public') { data.privateFiltered = true; data.sections = data.sections.filter(s => !s.private); }
      if (testMode === 'legacy') return new Response(JSON.stringify({ content: 'var sections = [];' }));
      return new Response(JSON.stringify(data));
    };
  });
  const preserved = (await rpc('cache.get')).dataEtag;
  for (const mode of ['no-kv', 'static', 'public', 'legacy', 'conflict']) {
    await worker.evaluate(mode => { testMode = mode; saveAttempts = 0; }, mode);
    result = await click(await targetId(), 'https://example.invalid/rejected-' + mode);
    assert.equal(result.error, true);
    assert.equal(await worker.evaluate(() => saveAttempts), mode === 'conflict' ? 1 : 0);
    assert.equal((await rpc('cache.get')).dataEtag, preserved);
  }
  await worker.evaluate(() => { globalThis.fetch = guardFetch; });
  // Logout and anonymous sync retain full local data and visible menu destinations, but cannot save.
  const cached = await rpc('cache.get'); await rpc('logout');
  const anonymous = await rpc('sync', { force: true }); assert.equal(anonymous.loggedIn, false); assert.equal(anonymous.snapshot.dataEtag, cached.dataEtag);
  result = await click(await targetId('private'), 'https://example.invalid/unauthorized'); assert.equal(result.error, true); assert.match(result.text, /登录/);
  assert.equal((await rpc('cache.get')).dataEtag, cached.dataEtag);
  await context.clearCookies(); await context.close();
  // Restart the same extension/profile, offline, and verify real IndexedDB persistence.
  await launch(); await context.setOffline(true);
  // CDP offline emulation does not consistently apply to extension service-worker targets.
  await worker.evaluate(() => { globalThis.onlineFetch = fetch; globalThis.fetch = async () => { throw new TypeError('Synthetic disconnected extension worker'); }; });
  page = await context.newPage(); await page.goto(`chrome-extension://${id}/home.html`);
  await page.locator('.group').filter({ hasText: 'Private cache fixture' }).waitFor();
  await page.locator('#status.error').waitFor(); assert(await page.locator('#save').isDisabled());
  const restartedStart = await context.newPage(); await restartedStart.goto(`chrome-extension://${id}/start.html`);
  await restartedStart.getByRole('button', { name: 'Visible private fixture · Private', exact: true }).click();
  await restartedStart.getByRole('link', { name: 'Offline Private start fixture', exact: true }).waitFor();
  await restartedStart.locator('#status.error').waitFor();
  assert.equal(await restartedStart.locator('h2').filter({ hasText: 'Private cache fixture' }).count(), 0);
  await restartedStart.close();
  assert.equal((await rpc('cache.get')).dataEtag, cached.dataEtag);
  assert(await targetId('private'));
  await worker.evaluate(() => chrome.contextMenus.update('smarttools-root', { enabled: true }));
  await context.setOffline(false);
  await worker.evaluate(() => { globalThis.fetch = onlineFetch; });
  // A revoked permission forbids network requests but not local cache reads (native prompt is manual).
  await worker.evaluate(() => { globalThis.realContains = chrome.permissions.contains; chrome.permissions.contains = async () => false; });
  await assert.rejects(rpc('sync'), /权限已撤销/);
  assert.equal((await rpc('cache.get')).privateFiltered, false);
  await worker.evaluate(() => { chrome.permissions.contains = realContains; });
  // A second loopback origin has a separate real authenticated snapshot.
  await worker.evaluate(configUrl => chrome.storage.sync.set({ configUrl }), other + '/config.html');
  await page.waitForFunction(url => document.querySelector('#siteUrl').value === url, other + '/config.html');
  await rpc('login', { username, password }, page, other);
  assert.equal((await rpc('cache.get', {}, page, other)).site, other);
  await rpc('cache.clear', {}, page, other); assert.equal(await rpc('cache.get', {}, page, other), null);
  await worker.evaluate(configUrl => chrome.storage.sync.set({ configUrl }), base + '/config.html');
  await page.waitForFunction(url => document.querySelector('#siteUrl').value === url, base + '/config.html');
  assert.equal((await rpc('cache.get')).site, base);
  // Deliberately corrupted fixture cache errors clearly, then forced sync repairs it.
  await page.evaluate(async site => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('smarttools-confirmed-cache', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    await new Promise((resolve, reject) => { const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put({ site, schema: -1 }); tx.oncomplete = resolve; tx.onerror = reject; }); db.close();
  }, base);
  await assert.rejects(rpc('cache.get'), /损坏/);
  await rpc('login', { username, password }); assert.equal((await rpc('cache.get')).schema, 1);
  // Clear during a delayed sync must invalidate its response and not repopulate the cache.
  await worker.evaluate(() => {
    globalThis.savedFetch = fetch; globalThis.waiting = false;
    globalThis.fetch = async (url, options) => { if (String(url).endsWith('/api/data?format=structured')) { waiting = true; await new Promise(resolve => { globalThis.releaseFetch = resolve; }); } return savedFetch(url, options); };
  });
  const syncing = rpc('sync', { force: true }).catch(error => error);
  for (let i = 0; i < 100 && !await worker.evaluate(() => waiting); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert(await worker.evaluate(() => waiting));
  const clearing = rpc('cache.clear', { all: true });
  await new Promise(resolve => setTimeout(resolve, 100)); await worker.evaluate(() => releaseFetch());
  assert((await syncing) instanceof Error); await clearing;
  assert.equal(await rpc('cache.get'), null);
  assert.equal(await worker.evaluate(async site => testCache.readSnapshot(site), other), null);
  assert.equal(Object.keys(await worker.evaluate(async () => (await testCache.readMenuIndex()).entries)).length, 0);
  await page.waitForFunction(() => document.querySelectorAll('.group').length === 0);
  console.log(JSON.stringify({ ok: true, realMV3: true, sharedIndexedDB: true, restartOfflinePrivate: true, logoutReadOnly: true, draftsIsolated: true, metaAvoidsFullDownload: true, menuPageLinkParentDuplicateSerialCapture: true, stableTargets: true, contentScriptDenied: true, storageFailureAndCorruption: true, staticNoKVAuthAndConflictGuards: true, multiSiteAndClearRace: true, nativeMenuAndPermissionPrompt: 'manual not automated', artifactDirectory: directory }, null, 2));
} finally { await context?.close(); }

