import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Real MV3, synthetic content only. This complements cache/import acceptance, not a mock UI.
const base = process.env.SMARTTOOLS_BASE_URL || 'http://127.0.0.1:8788';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Isolated local Pages required');
const username = process.env.SMARTTOOLS_TEST_USER || 'testadmin';
const password = process.env.SMARTTOOLS_TEST_PASS || 'TestPass2026';
const fixture = [
  { key: 'daily', kind: 'card', label: 'Daily essentials', visible: true, cards: [
    { id: 'docs', title: 'Developer docs', desc: 'Official documentation and reference guides', url: 'https://example.invalid/docs', icon: 'DD' },
    { id: 'reading', title: 'Reading list', url: 'https://example.invalid/reading', type: 'expandable', subCards: [{ id: 'child', title: 'Nested needle', url: 'https://example.invalid/child', desc: 'Child-only search phrase' }] },
    { id: 'nolink', title: 'Design references', type: 'expandable', subCards: [{ title: 'Typography', url: 'https://example.invalid/type' }] },
    { id: 'long', title: '很长的合成书签标题：界面验收应保持完整语义且不得溢出容器 Very long bookmark title', desc: 'A synthetic long description to verify readable list density and line wrapping.', url: 'https://example.invalid/long', iconImg: 'https://example.invalid/missing.png' },
    { id: 'unsafe', title: 'Unsafe fixture', url: 'javascript:alert(1)' }
  ] },
  { key: 'work', kind: 'card', label: 'Development', cards: [{ id: 'git', title: 'Source code', icon: 'SC', url: 'https://example.invalid/source' }, { title: 'API reference', icon: 'API', url: 'https://example.invalid/api' }] },
  { key: 'private', kind: 'card', label: 'Synthetic Private', private: true, cards: [{ title: 'Private local copy', url: 'https://example.invalid/private' }] },
  { key: 'hidden', kind: 'card', label: 'Synthetic hidden', visible: false, cards: [{ title: 'Hidden needle', url: 'https://example.invalid/hidden' }] },
  { key: 'special', kind: 'contact', label: 'Contacts', cards: [{ title: 'Special fixture', url: 'mailto:test@example.invalid', preserved: { value: 42 } }] }
];
const login = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0];
const latest = await (await fetch(base + '/api/data?format=structured', { headers: { Cookie: cookie } })).json();
assert.equal((await fetch(base + '/api/save', { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ content: 'var sections = ' + JSON.stringify(fixture) + ';', baseEtag: latest.dataEtag, baseSource: latest.configured }) })).status, 200);
await mkdir('.wrangler', { recursive: true }); const directory = await mkdtemp(path.resolve('.wrangler/extension-pages-'));
const staged = path.join(directory, 'extension'); await cp('extensions/open-tabs-importer', staged, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(staged, 'manifest.json'), 'utf8')); manifest.host_permissions = [base + '/*'];
await writeFile(path.join(staged, 'manifest.json'), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(path.join(directory, 'profile'), { executablePath: process.env.EXTENSION_CHROME_PATH || chromium.executablePath(), headless: true, args: [`--disable-extensions-except=${staged}`, `--load-extension=${staged}`] });
context.setDefaultTimeout(15000);
const errors = [];
context.on('page', page => { page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|unsafe-eval/.test(message.text())) errors.push(message.text()); }); });
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // URL.origin is null for extension schemes in Node, so derive explicitly.
  const extension = `chrome-extension://${new URL(worker.url()).host}/`;
  await worker.evaluate(configUrl => chrome.storage.sync.set({ configUrl }), base + '/config.html');
  await context.route('https://example.invalid/**', route => route.fulfill({ status: 404, contentType: 'text/html', body: '<title>Synthetic destination</title>' }));
  const start = await context.newPage(); await start.goto(extension + 'start.html');
  await start.locator('.tile').first().waitFor();
  await start.locator('#accountTrigger').click(); await start.locator('#username').fill(username); await start.locator('#password').fill(password); await start.locator('#loginForm button').click();
  await start.locator('#logout:not([hidden])').waitFor(); await start.getByRole('button', { name: 'Synthetic Private · Private', exact: true }).waitFor();
  assert.equal(await start.locator('.nav-label').filter({ hasText: 'Synthetic hidden' }).count(), 0);
  await start.keyboard.press('Escape');
  const manager = await context.newPage(); await manager.goto(extension + 'home.html'); await manager.locator('#addGroup:not([disabled])').waitFor();
  assert(await manager.locator('#cards').evaluate(el => el.classList.contains('list-view')));
  assert.equal(await start.locator('.desktop-sidebar').evaluate(el => getComputedStyle(el).width), '56px');
  assert.equal(await start.locator('.tile-mark').first().evaluate(el => getComputedStyle(el).width), '60px');
  assert.equal(await manager.locator('.sidebar').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(245, 244, 242)');
  assert.equal(await manager.locator('.group').filter({ hasText: 'Synthetic hidden' }).count(), 1);
  const rpc = (page, action, extra = {}) => page.evaluate(({ action, configUrl, extra }) => chrome.runtime.sendMessage({ channel: 'smarttools-client', action, configUrl, ...extra }), { action, configUrl: base + '/config.html', extra });
  assert.equal((await rpc(start, 'save', { sections: [] })).status, 409, 'trusted start reaches version guard');
  assert.equal((await rpc(start, 'unknown')).status, 403, 'unknown action denied before dispatch');
  assert.equal((await rpc(start, 'cache.get')).value.sections.length, fixture.length);
  // Exact page allowlist: a query-string lookalike cannot call the cache channel.
  const lookalike = await context.newPage(); await lookalike.goto(extension + 'start.html?untrusted'); assert.equal((await rpc(lookalike, 'cache.get')).status, 403); await lookalike.close();
  await start.locator('#search').fill('Nested needle'); assert.equal(await start.locator('.tile').count(), 1); assert(await start.getByRole('link', { name: 'Nested needle', exact: true }).isVisible());
  await start.locator('#search').fill('Hidden needle'); assert.equal(await start.locator('.tile').count(), 0); await start.locator('#search').fill('');
  const reading = start.locator('#cards .tile').filter({ has: start.locator('.tile-title').filter({ hasText: /^Reading list$/ }) });
  await reading.locator('.tile-main').click(); assert(await start.locator('#folderPanel').isVisible());
  assert.equal(await start.locator('#folderTools a').getAttribute('target'), '_blank');
  assert(await start.getByRole('link', { name: 'Nested needle', exact: true }).isVisible());
  const opened = context.waitForEvent('page'); await start.locator('#folderTools a').click(); const destination = await opened; await destination.waitForLoadState(); assert.equal(destination.url(), 'https://example.invalid/reading'); await destination.close();
  await start.keyboard.press('Escape'); assert(await start.locator('#folderBackdrop').isHidden());
  const noLink = start.locator('#cards .tile').filter({ has: start.locator('.tile-title').filter({ hasText: /^Design references$/ }) });
  await noLink.locator('.tile-main').click(); assert(await start.getByRole('link', { name: 'Typography', exact: true }).isVisible()); await start.locator('#closeFolder').click();
  assert.equal(await start.locator('.tile').filter({ hasText: '很长的合成' }).locator('img:not([hidden])').count(), 0, 'failed image uses local text fallback');
  await start.getByRole('button', { name: 'Contacts', exact: true }).click(); assert(await start.locator('.special-note').filter({ hasText: '完整后台' }).isVisible());
  await start.getByRole('button', { name: 'Daily essentials', exact: true }).click(); assert.equal(start.url(), extension + 'start.html');
  // Homepage edits use independent memory drafts; direct UI save updates the confirmed cache.
  const tileNamed = name => start.locator('#cards .tile').filter({ has: start.locator('.tile-title').filter({ hasText: new RegExp('^' + name + '$') }) });
  const editStart = async (name, title) => {
    await tileNamed(name).locator('.tile-more').click(); await start.getByRole('menuitem', { name: '编辑', exact: true }).click();
    await start.locator('[name=title]').fill(title); await start.locator('#editForm button[type=submit]').click();
  };
  assert.equal(await start.locator('a').evaluateAll(nodes => nodes.filter(n => n.protocol === 'javascript:').length), 0);
  await editStart('Developer docs', 'Homepage saved fixture');
  assert(await manager.getByRole('link', { name: 'Developer docs', exact: true }).isVisible());
  assert.equal((await rpc(start, 'cache.get')).value.sections[0].cards[0].title, 'Developer docs');
  await start.locator('#save').click(); await start.locator('#status').filter({ hasText: '已保存到云端' }).waitFor();
  await manager.getByRole('link', { name: 'Homepage saved fixture', exact: true }).waitFor();
  await editStart('Homepage saved fixture', 'Developer docs'); await start.locator('#save').click(); await start.locator('#status').filter({ hasText: '已保存到云端' }).waitFor();
  await manager.getByRole('link', { name: 'Developer docs', exact: true }).waitFor();
  // Native HTML drag/drop: a leaf enters a folder; folder-on-folder center drop is rejected.
  await tileNamed('Developer docs').dragTo(tileNamed('Reading list'));
  await tileNamed('Reading list').locator('.tile-main').click();
  assert(await start.locator('#folderCards').getByRole('link', { name: 'Developer docs', exact: true }).isVisible());
  assert.equal((await rpc(start, 'cache.get')).value.sections[0].cards[1].subCards.length, 1);
  await start.screenshot({ path: path.join(directory, 'start-folder-draft.png') }); await start.keyboard.press('Escape');
  start.once('dialog', d => d.accept()); await start.locator('#discard').click();
  await tileNamed('Design references').dragTo(tileNamed('Reading list')); assert(await start.locator('#draftBar').isHidden());
  // Ordinary tile drops reorder rather than creating a folder. Search disables drag.
  await tileNamed('Developer docs').dragTo(tileNamed('Unsafe fixture'), { targetPosition: { x: 80, y: 40 } });
  assert.equal(await start.locator('#cards .tile-title').nth(4).innerText(), 'Developer docs');
  await start.locator('#search').fill('Developer'); assert.equal(await tileNamed('Developer docs').getAttribute('draggable'), 'false');
  await start.locator('#search').fill(''); start.once('dialog', d => d.accept()); await start.locator('#discard').click();
  // Cross-group and cross-layer moves use the original object, not a filtered DOM index.
  await tileNamed('Developer docs').dragTo(start.getByRole('button', { name: 'Development', exact: true }));
  assert.equal(await start.locator('#groupTitle').innerText(), 'Development'); assert(await tileNamed('Developer docs').isVisible());
  start.once('dialog', d => d.accept()); await start.locator('#discard').click(); await start.getByRole('button', { name: 'Daily essentials', exact: true }).click();
  await tileNamed('Developer docs').dragTo(tileNamed('Reading list')); await tileNamed('Reading list').locator('.tile-main').click();
  const folderItem = title => start.locator('#folderCards .tile').filter({ has: start.getByRole('link', { name: title, exact: true }) });
  await folderItem('Developer docs').dragTo(folderItem('Nested needle'), { targetPosition: { x: 4, y: 30 } });
  assert.equal(await start.locator('#folderCards .tile-title').first().innerText(), 'Developer docs');
  // Move beyond the native drag threshold before targeting a surface behind the folder backdrop.
  // dragTo's pre-move actionability check otherwise waits on the backdrop before dragstart can run.
  const originBox = await folderItem('Developer docs').boundingBox(); const destinationBox = await start.getByRole('button', { name: 'Development', exact: true }).boundingBox();
  await start.mouse.move(originBox.x + originBox.width / 2, originBox.y + 30); await start.mouse.down();
  await start.mouse.move(originBox.x + originBox.width / 2 + 16, originBox.y + 40, { steps: 4 });
  await start.waitForFunction(() => document.body.classList.contains('dragging'));
  await start.mouse.move(destinationBox.x + 20, destinationBox.y + 20, { steps: 12 });
  await start.mouse.move(destinationBox.x + 21, destinationBox.y + 21); await start.mouse.up();
  assert(await start.locator('#folderBackdrop').isHidden()); assert.equal(await start.locator('#groupTitle').innerText(), 'Development');
  assert(await tileNamed('Developer docs').isVisible()); start.once('dialog', d => d.accept()); await start.locator('#discard').click();
  await start.getByRole('button', { name: 'Synthetic Private · Private', exact: true }).click();
  start.once('dialog', d => d.dismiss()); await tileNamed('Private local copy').dragTo(start.getByRole('button', { name: 'Development', exact: true }));
  assert(await start.locator('#draftBar').isHidden()); assert(await tileNamed('Private local copy').isVisible());
  await start.getByRole('button', { name: 'Daily essentials', exact: true }).click();
  const groupRow = name => start.locator('.nav-row').filter({ has: start.getByRole('button', { name, exact: true }) });
  await groupRow('Daily essentials').dragTo(groupRow('Development'), { targetPosition: { x: 20, y: 55 } });
  assert.equal(await start.locator('#groups .nav-group').first().getAttribute('aria-label'), 'Development');
  start.once('dialog', d => d.accept()); await start.locator('#discard').click();
  // Keyboard menu entry, unapplied-input guard, and new folder/child flows.
  await tileNamed('Developer docs').locator('.tile-main').focus(); await start.keyboard.press('Shift+F10');
  await start.getByRole('menuitem', { name: '编辑', exact: true }).click(); await start.locator('[name=title]').fill('Unapplied desktop');
  start.once('dialog', d => d.dismiss()); await start.keyboard.press('Escape'); assert(await start.locator('#editor').isVisible());
  start.once('dialog', d => d.accept()); await start.locator('#cancelEdit').click();
  await start.locator('.tile-add button').click(); await start.getByRole('menuitem', { name: '新建文件夹', exact: true }).click();
  await start.locator('[name=title]').fill('Draft folder'); await start.locator('#editForm button[type=submit]').click();
  await tileNamed('Draft folder').locator('.tile-main').click(); await start.getByRole('button', { name: '新增子书签', exact: true }).click();
  await start.locator('[name=title]').fill('Draft child'); await start.locator('[name=url]').fill('https://example.invalid/draft-child'); await start.locator('#editForm button[type=submit]').click();
  assert(await start.locator('#folderCards').getByRole('link', { name: 'Draft child', exact: true }).isVisible());
  await start.keyboard.press('Escape'); start.once('dialog', d => d.accept()); await start.locator('#discard').click();
  assert.equal(await tileNamed('Draft folder').count(), 0);
  // Drawer close guards and memory-only drafts.
  await manager.setViewportSize({ width: 1280, height: 900 });
  const docs = manager.locator('.card').filter({ has: manager.getByRole('link', { name: 'Developer docs', exact: true }) });
  await docs.locator('.quick-edit').focus(); await manager.keyboard.press('Enter');
  assert(await manager.locator('#editor').evaluate(el => el.classList.contains('bookmark-editor')));
  await manager.locator('[name=title]').fill('Unapplied fixture');
  manager.once('dialog', dialog => dialog.dismiss()); await manager.mouse.click(500, 300); assert(await manager.locator('#editor').isVisible(), 'outside click protects unapplied fields'); manager.once('dialog', dialog => dialog.dismiss()); await manager.keyboard.press('Escape'); assert(await manager.locator('#editor').isVisible());
  manager.once('dialog', dialog => dialog.accept()); await manager.locator('#cancelEdit').click(); assert(await manager.locator('#editor').isHidden());
  await docs.locator('.card-actions > summary').click(); await docs.getByRole('button', { name: '编辑', exact: true }).click(); await manager.locator('[name=title]').fill('Saved dual-page fixture'); await manager.locator('#editForm button[type=submit]').click();
  assert.equal(await start.locator('.tile-title').filter({ hasText: 'Saved dual-page fixture' }).count(), 0);
  assert(!(await rpc(start, 'cache.get')).value.sections[0].cards.some(c => c.title === 'Saved dual-page fixture'));
  assert(await manager.locator('#draftBar').isVisible()); await manager.locator('#save').click(); await manager.locator('#status').filter({ hasText: '已保存到云端' }).waitFor();
  await start.locator('.tile-title').filter({ hasText: 'Saved dual-page fixture' }).waitFor(); assert(await manager.locator('#draftBar').isHidden());
  console.log('Dual-page baseline complete');
  // Regression: rejected/unknown save results never masquerade as logout or discard a draft.
  await worker.evaluate(() => {
    globalThis.failureTestFetch = fetch; globalThis.failureMode = null; globalThis.failedPostCount = 0;
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/api/save') && failureMode) {
        failedPostCount++;
        if (failureMode === 'timeout') throw new DOMException('Synthetic timeout', 'TimeoutError');
        if (failureMode === '503') return new Response(JSON.stringify({ ok: false, code: 'SAVE_STORAGE_ERROR', outcomeUnknown: true, error: 'Synthetic storage temporarily unavailable' }), { status: 503 });
        return new Response('<html>synthetic gateway response</html>', { status: Number(failureMode) });
      }
      return failureTestFetch(url, options);
    };
  });
  for (const page of [start, manager]) {
    await page.bringToFront(); await page.locator('#refresh').click(); await page.waitForFunction(() => !document.querySelector('#addGroup').disabled);
    if (page === start) await editStart('Saved dual-page fixture', 'Save error draft');
    else {
      const card = manager.locator('.card').filter({ has: manager.getByRole('link', { name: 'Saved dual-page fixture', exact: true }) });
      await card.locator('.quick-edit').click(); await manager.locator('[name=title]').fill('Save error draft'); await manager.locator('#editForm button[type=submit]').click();
    }
    console.log('Save error scenarios', page === start ? 'start' : 'manager');
    for (const mode of ['503', '403', '500', 'timeout']) {
      await worker.evaluate(mode => { failureMode = mode; failedPostCount = 0; }, mode);
      await page.locator('#save').click(); await page.locator('#status.error').filter({ hasText: '/api/save' }).waitFor();
      await page.waitForFunction(() => !document.querySelector('#checkConnection').hidden && !document.querySelector('#refresh').disabled);
      assert.equal(await page.locator('#accountLabel').textContent(), '管理员', mode + ' must not expire identity');
      assert(await page.locator('#draftBar').isVisible()); assert(await page.locator('#save').isDisabled());
      assert.equal(await worker.evaluate(() => failedPostCount), 1, 'no automatic write retry');
      assert.equal((await rpc(page, 'cache.get')).value.sections[0].cards[0].title, 'Saved dual-page fixture');
      await page.locator('#accountTrigger').click(); await page.locator('#checkConnection').click();
      await page.waitForFunction(() => !document.querySelector('#save').disabled);
      assert(await page.locator('#draftBar').isVisible(), 'recheck must retain the draft'); await page.keyboard.press('Escape');
    }
    await worker.evaluate(() => { failureMode = null; });
    page.once('dialog', d => d.accept()); await page.locator('#discard').click();
  }
  // Each page independently revalidates connectivity; another page's auth event is not enough.
  await start.bringToFront(); await start.locator('#refresh').click(); await start.waitForFunction(() => !document.querySelector('#addGroup').disabled);
  // A real HTTP 401, including a non-JSON upstream body, does require login.
  await editStart('Saved dual-page fixture', 'Expired session draft');
  await worker.evaluate(() => { failureMode = '401'; }); await start.locator('#save').click();
  await start.locator('#status.error').filter({ hasText: 'HTTP 401' }).waitFor();
  assert.equal(await start.locator('#accountLabel').textContent(), '登录'); assert(await start.locator('#draftBar').isVisible());
  await worker.evaluate(() => { globalThis.fetch = failureTestFetch; });
  start.once('dialog', d => d.accept()); await start.locator('#discard').click(); await start.locator('#refresh').click();
  await start.waitForFunction(() => !document.querySelector('#addGroup').disabled);
  // Concurrent drafts: a manager save must not overwrite this desktop's draft or baseline.
  await editStart('Saved dual-page fixture', 'Desktop conflict draft');
  const savedCard = manager.locator('.card').filter({ has: manager.getByRole('link', { name: 'Saved dual-page fixture', exact: true }) });
  await savedCard.locator('.quick-edit').click(); await manager.locator('[name=title]').fill('Newer manager version'); await manager.locator('#editForm button[type=submit]').click();
  await manager.locator('#save').click(); await manager.locator('#status').filter({ hasText: '已保存到云端' }).waitFor();
  await start.locator('#status').filter({ hasText: '草稿保留' }).waitFor(); await start.locator('#save').click();
  await start.locator('#status.error').filter({ hasText: '云端数据' }).waitFor();
  assert(await tileNamed('Desktop conflict draft').isVisible()); assert(await start.locator('#draftBar').isVisible());
  assert.equal((await rpc(start, 'cache.get')).value.sections[0].cards[0].title, 'Newer manager version');
  // Offline detection retains local edits but disables modification and cloud writes.
  await worker.evaluate(() => { globalThis.desktopFetch = fetch; globalThis.fetch = async () => { throw new TypeError('Synthetic offline'); }; });
  await rpc(start, 'sync'); await start.waitForFunction(() => document.querySelector('#addGroup').disabled);
  assert(await tileNamed('Desktop conflict draft').isVisible()); assert(await start.locator('#save').isDisabled());
  await worker.evaluate(() => { globalThis.fetch = desktopFetch; }); await rpc(start, 'sync');
  start.once('dialog', d => d.accept()); await start.locator('#discard').click(); await start.locator('#refresh').click();
  await tileNamed('Newer manager version').waitFor(); await start.waitForFunction(() => !document.querySelector('#addGroup').disabled);
  await editStart('Newer manager version', 'Saved dual-page fixture'); await start.locator('#save').click(); await start.locator('#status').filter({ hasText: '已保存到云端' }).waitFor();
  await manager.getByRole('link', { name: 'Saved dual-page fixture', exact: true }).waitFor();
  // A trusted homepage still cannot bypass manager-only static initialization.
  await worker.evaluate(() => { globalThis.desktopFetch = fetch; globalThis.fetch = async (url, options) => { const response = await desktopFetch(url, options); if (!String(url).endsWith('/api/data?format=structured')) return response; const data = await response.json(); data.source = 'static'; data.configured = 'static'; return new Response(JSON.stringify(data), { status: 200 }); }; });
  const confirmed = (await rpc(start, 'cache.get')).value;
  assert.equal((await rpc(start, 'save', { sections: confirmed.sections, baseEtag: confirmed.dataEtag, baseSource: 'static', initialize: true })).status, 403);
  await worker.evaluate(() => { globalThis.fetch = desktopFetch; });
  await manager.locator('#refresh').click(); await manager.waitForFunction(() => !document.querySelector('#addGroup').disabled);
  // Separate tab reuse must not navigate either page away or lose unsaved input.
  await manager.locator('#addBookmark').click(); await manager.locator('[name=title]').fill('Drawer dimensions fixture');
  for (const width of [1280, 1047, 820, 390, 320]) {
    await manager.setViewportSize({ width, height: 900 });
    const drawer = await manager.locator('#editor').boundingBox(); assert(Math.abs(drawer.x + drawer.width - width) < 2); assert(drawer.width <= width);
    assert(await manager.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await manager.screenshot({ path: path.join(directory, `manager-editor-${width}.png`) });
    await start.setViewportSize({ width, height: 900 });
    assert(await start.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await start.screenshot({ path: path.join(directory, `start-${width}.png`), fullPage: true });
    await start.locator('#accountTrigger').click(); await start.locator('.cache-menu summary').click();
    const panel = await start.locator('.account-panel').boundingBox(); assert(panel.x >= 0 && panel.x + panel.width <= width && panel.y + panel.height <= 900);
    await start.locator('#clearCache').focus(); await start.keyboard.press('Escape'); assert(await start.locator('#accountTrigger').evaluate(el => el === document.activeElement));
  }
  manager.once('dialog', dialog => dialog.accept()); await manager.keyboard.press('Escape');
  for (const width of [1280, 1047, 820, 390, 320]) {
    await manager.setViewportSize({ width, height: 900 }); assert(await manager.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await manager.screenshot({ path: path.join(directory, `manager-list-${width}.png`), fullPage: true });
  }
  await manager.setViewportSize({ width: 390, height: 900 });
  await manager.locator('#openSidebar').focus(); await manager.keyboard.press('Enter'); await manager.locator('.group').filter({ hasText: 'Synthetic hidden' }).click();
  assert(await manager.getByRole('link', { name: 'Hidden needle', exact: true }).isVisible());
  await manager.locator('#openSidebar').click(); await manager.keyboard.press('Escape'); assert.equal(await manager.locator('#openSidebar').getAttribute('aria-expanded'), 'false');
  await manager.setViewportSize({ width: 1280, height: 900 }); await manager.locator('#libraryNav .nav-item').first().click();
  await manager.locator('#gridView').click(); assert.equal(await manager.locator('#cards').evaluate(el => getComputedStyle(el).display), 'grid');
  await manager.screenshot({ path: path.join(directory, 'manager-grid-1280.png'), fullPage: true }); await manager.locator('#listView').click();
  await manager.setViewportSize({ width: 1280, height: 900 }); await start.setViewportSize({ width: 1280, height: 900 });
  await manager.locator('#addGroup').click(); await manager.locator('[name=label]').fill('Discard-only group'); await manager.locator('#editForm button[type=submit]').click();
  const pagesBefore = context.pages().length; await manager.locator('#openStart').click(); assert.equal(context.pages().length, pagesBefore); assert(await manager.locator('#draftBar').isVisible());
  await start.locator('#openManager').click(); assert.equal(context.pages().length, pagesBefore); assert(await manager.locator('#draftBar').isVisible());
  manager.once('dialog', dialog => dialog.accept()); await manager.locator('#discard').click(); assert.equal(await manager.locator('.group').filter({ hasText: 'Discard-only group' }).count(), 0);
  // Both popup entry buttons reuse these exact tabs, while import buttons remain present.
  const popup = await context.newPage(); await popup.goto(extension + 'popup.html'); const popupCount = context.pages().length;
  assert.equal((await rpc(popup, 'save', { sections: [] })).status, 403); await popup.locator('#openStart').click(); await popup.locator('#status').filter({ hasText: '已打开浏览主页' }).waitFor();
  await popup.locator('#openHome').click(); await popup.locator('#status').filter({ hasText: '已打开书签管理' }).waitFor(); assert.equal(context.pages().length, popupCount); assert(await popup.locator('#importActive').isVisible()); await popup.close();
  await start.getByRole('button', { name: 'Synthetic Private · Private', exact: true }).click();
  await start.locator('#accountTrigger').click(); start.once('dialog', dialog => dialog.accept()); await start.locator('#logout').click(); await start.locator('#loginForm:not([hidden])').waitFor();
  assert.equal((await rpc(start, 'save', { sections: [] })).status, 401); assert(await start.getByRole('link', { name: 'Private local copy', exact: true }).isVisible()); await manager.waitForFunction(() => document.querySelector('#addGroup').disabled);
  // Offline/revoked permission retain homepage data; extension worker is the network initiator.
  await worker.evaluate(() => { globalThis.savedFetch = fetch; globalThis.fetch = async () => { throw new TypeError('Synthetic offline'); }; });
  await start.locator('#refresh').click(); await start.locator('#status.error').waitFor(); assert(await start.getByRole('link', { name: 'Private local copy', exact: true }).isVisible());
  await worker.evaluate(() => { globalThis.fetch = savedFetch; globalThis.savedContains = chrome.permissions.contains; chrome.permissions.contains = async () => false; });
  await start.locator('#refresh').click(); await start.locator('#status').filter({ hasText: '权限已撤销' }).waitFor(); assert((await rpc(start, 'cache.get')).ok);
  await worker.evaluate(() => { chrome.permissions.contains = savedContains; });
  // Outside blank clicks close account forms, including on short screens.
  await start.setViewportSize({ width: 390, height: 500 }); await start.locator('#accountTrigger').click(); await start.locator('#password').fill('unsent-fixture'); await start.locator('.cache-menu summary').click();
  const short = await start.locator('.account-panel').boundingBox(); assert(short.y + short.height <= 500);
  await start.locator('.topbar').click({ position: { x: 1, y: 1 } }); await start.waitForFunction(() => !document.querySelector('#accountMenu').open && document.querySelector('#password').value === '');
  await start.locator('#accountTrigger').click(); await start.locator('.cache-menu summary').click(); start.once('dialog', dialog => dialog.accept()); await start.locator('#clearCache').click();
  await start.waitForFunction(() => document.querySelectorAll('.tile').length === 0); await manager.waitForFunction(() => document.querySelectorAll('.group').length === 0);
  assert.equal((await rpc(start, 'cache.get')).value, null);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, realMV3DualPages: true, guardedHomepageRPC: true, homepageCrudDragAndSave: true, homepageConflictAndOfflineDraft: true, saveFailureKeepsIdentityAndDraft: true, real401RequiresLogin: true, managerOnlyInitialization: true, exactPagePolicy: true, sharedConfirmedOnly: true, drawerGuardAndDiscard: true, hiddenPrivateSearchChildren: true, safeLinksAndIconFallback: true, separateTabReuse: true, offlineLogoutRevokeAndClear: true, desktopAnd320390: true, noCspErrors: true, artifactDirectory: directory }, null, 2));
} catch (error) { console.error(error); throw error; } finally { await context.close(); }
