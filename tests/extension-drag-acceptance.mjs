import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Real homepage modules, CSS and native mouse dragging with synthetic RPC/cache.
// Authentication and real IndexedDB/save integration remain in extension-v2-acceptance.mjs.
const fixtureOrigin = 'https://extension-fixture.invalid';
const fixture = { schema: 2, etag: 'synthetic-version', source: 'kv', configured: 'kv', hasKV: true, savedAt: 1,
  document: { schemaVersion:2, updatedAt: 1, roots: [
    { id:'a', type:'folder', title:'Daily', visible:true, isPrivate:false, children:[
      { id:'folder', type:'folder', title:'Synthetic folder', visible:true, isPrivate:false, url:'https://example.invalid/parent', children:[
        { id:'a-drop', type:'bookmark', title:'Synthetic child', url:'https://example.invalid/child', extensions:{ legacy:{ custom:{ retained:true } } } }
      ] },
      ...Array.from({length:16},(_,i)=>({id:'c'+i,type:'bookmark',title:'Bookmark '+i,url:'https://example.invalid/'+i}))
    ] },
    { id:'b', type:'folder', title:'Work', visible:true, isPrivate:false, children:[] }
  ] } };
const browser = await chromium.launch({ executablePath: process.env.EXTENSION_CHROME_PATH || chromium.executablePath(), headless: true });
const errors = [];
try {
  for (const destination of ['desktop', 'same-category', 'other-category', 'folder-end']) {
    const snapshot = structuredClone(fixture);
    if (destination === 'folder-end') snapshot.document.roots[0].children[0].children.push({ id: 'second', type:'bookmark', title: 'Second child', url: 'https://example.invalid/second' });
    const page = await browser.newPage({ viewport: { width: 1510, height: 720 } });
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== fixtureOrigin) return route.abort();
      const name = path.basename(url.pathname);
      if (!/\.(html|js|css)$/.test(name)) return route.abort();
      const body = await readFile(path.join('extensions/qiye', name));
      await route.fulfill({ body, contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.addInitScript(snapshot => {
      const events = { addListener() {} };
      globalThis.confirmedFixture = structuredClone(snapshot);
      globalThis.fixtureSaves = [];
      globalThis.chrome = {
        runtime: { id: 'synthetic', getURL: p => location.origin + '/' + p, onMessage: events, sendMessage: async message => {
          if (message.action === 'cache.get') return { ok: true, value: structuredClone(confirmedFixture) };
          if (message.action === 'save') {
            fixtureSaves.push(structuredClone(message));
            confirmedFixture = { ...confirmedFixture, document: structuredClone(message.document), etag: 'saved-version' };
          }
          return { ok: true, value: { saved: message.action === 'save', loggedIn: true, snapshot: structuredClone(confirmedFixture) } };
        } },
        storage: { sync: { get: async () => ({ configUrl: 'https://example.invalid/config.html' }) }, local: { get: async () => ({}), set: async () => {} }, onChanged: events },
        permissions: { onRemoved: events, contains: async () => true }
      };
    }, snapshot);
    await page.goto(fixtureOrigin + '/start.html');
    await page.locator('#addGroup:not([disabled])').waitFor();
    await page.getByRole('button', { name: '打开文件夹：Synthetic folder', exact: true }).click();
    assert.notEqual(await page.locator('#cards').getAttribute('data-drop'), await page.locator('#folderCards').getAttribute('data-drop'), 'desktop and folder must have distinct drop identities');
    const source = await page.locator('#folderCards').getByRole('link', { name: 'Synthetic child', exact: true }).boundingBox();
    const dropZone = destination === 'desktop' ? page.locator('#cards') : destination === 'folder-end' ? page.locator('#folderCards') : page.getByRole('button', { name: destination === 'same-category' ? 'Daily' : 'Work', exact: true });
    const target = await dropZone.boundingBox();
    // Start on the link/icon as a user does, not on an artificial draggable wrapper.
    await page.mouse.move(source.x + source.width / 2, source.y + 30); await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 20, source.y + 35, { steps: 4 });
    await page.waitForFunction(() => document.body.classList.contains('dragging'));
    const x = target.x + target.width - 5, y = target.y + target.height - 5;
    await page.mouse.move(x, y, { steps: 20 }); await page.mouse.move(x - 1, y - 1);
    assert(await dropZone.evaluate(el => el.closest('[data-ref],[data-drop]').classList.contains('drop-inside')), destination + ': correct drop container highlighted');
    await page.mouse.up();
    await page.locator('#draftBar:not([hidden])').waitFor();
    assert.deepEqual(await page.evaluate(() => confirmedFixture), snapshot, 'dragging never writes the confirmed cache');
    assert.equal(await page.evaluate(() => fixtureSaves.length), 0);
    if (destination === 'folder-end') {
      assert(await page.locator('#folderPanel').isVisible());
      assert.deepEqual(await page.locator('#folderCards .tile-title').allTextContents(), ['Second child', 'Synthetic child']);
      await page.keyboard.press('Escape');
    } else {
      assert(await page.locator('#folderBackdrop').isHidden());
      assert(await page.locator('#cards').getByRole('link', { name: 'Synthetic child', exact: true }).isVisible());
      assert.equal(await page.locator('#groupTitle').innerText(), destination === 'other-category' ? 'Work' : 'Daily');
    }
    // Native drag suppresses an immediate stray click for 250 ms.
    await page.waitForTimeout(300);
    await page.locator('#save').click(); await page.locator('#status').filter({ hasText: '已保存到云端' }).waitFor();
    const saved = await page.evaluate(() => fixtureSaves);
    assert.equal(saved.length, 1); assert.equal(saved[0].baseEtag, snapshot.etag); assert.equal(saved[0].baseSource, undefined);
    const parent = saved[0].document.roots[0].children.find(card => card.id === 'folder');
    assert.equal(parent.url, 'https://example.invalid/parent');
    const moved = destination === 'folder-end' ? parent.children.at(-1) : saved[0].document.roots[destination === 'other-category' ? 1 : 0].children.at(-1);
    assert.equal(moved.id, 'a-drop'); assert.equal(moved.url, 'https://example.invalid/child'); assert.deepEqual(moved.extensions.legacy.custom, { retained: true });
    assert.equal(moved.type, 'bookmark');
    assert.equal(parent.children.length, destination === 'folder-end' ? 2 : 0);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, distinctDropContainers: true, singleChildToSameDesktop: true, sameAndOtherCategory: true, folderBlankAreaReorder: true, linkInitiatedNativeDrag: true, draftOnlyUntilSave: true, fieldsPreserved: true }));
} finally { await browser.close(); }
