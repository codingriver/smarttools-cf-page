import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';

// Real layout/controller, synthetic UI preferences only; no auth, bookmarks or network.
const root = 'extensions/open-tabs-importer/';
const html = (await readFile(root + 'start.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
const css = await readFile(root + 'start.css', 'utf8');
const controller = await readFile(root + 'sidebar-resize.js', 'utf8');
const browser = await chromium.launch({ executablePath: process.env.EXTENSION_CHROME_PATH || chromium.executablePath(), headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent(html); await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: controller + `
    const listeners = [];
    window.fixture = { value: 180, writes: [], fail: false, clicks: 0, messages: [] };
    fixture.external = value => { fixture.value = value; for (const cb of listeners) cb({desktopSidebarWidth: {newValue: value}}, 'local'); };
    window.binding = bindSidebarResize({ sidebar: document.querySelector('#sidebar'), separator: document.querySelector('#sidebarResize'), report: text => fixture.messages.push(text),
      storage: { get: async () => ({desktopSidebarWidth: fixture.value}), set: async entry => { if(fixture.fail) throw Error('synthetic failure'); fixture.writes.push(entry); fixture.external(entry.desktopSidebarWidth); if (fixture.remoteAfterWrite) { fixture.external(fixture.remoteAfterWrite); fixture.remoteAfterWrite = null; } } },
      changes: { addListener: cb => listeners.push(cb) }
    });
    const groups = document.querySelector('#groups');
    for (let i=0;i<28;i++) { const row = document.createElement('div'); row.className='nav-row';
      row.innerHTML='<button class="nav-group" title="合成数据长分类名称 Synthetic long category"><span class="nav-glyph">星</span><span class="nav-label">合成数据长分类名称 Synthetic long category</span><span class="nav-private">♙</span></button><button class="nav-more" aria-label="分类操作">⋯</button>';
      groups.append(row);
    }
    document.querySelector('.nav-group').addEventListener('click',()=>fixture.clicks++);
  ` });
  await page.evaluate(() => binding.ready);
  const handle = page.locator('#sidebarResize');
  const width = () => handle.getAttribute('aria-valuenow').then(Number);
  const stored = () => page.evaluate(() => fixture.value);
  let pointerOffset = 0;
  const begin = async () => { const box = await handle.boundingBox(); pointerOffset = box.x + 4 - await width(); await page.mouse.move(box.x + 4, 150); await page.mouse.down(); };
  const move = async x => page.mouse.move(x + pointerOffset, 150, { steps: 6 });
  const expectStored = async value => page.waitForFunction(v => fixture.value === v, value);
  const drag = async x => { await begin(); await move(x); await page.mouse.up(); await expectStored(x); };
  assert.equal(await width(), 180);
  await begin(); await move(240);
  assert.equal(await width(), 240); assert.equal(await stored(), 180);
  assert.equal(await page.locator('.start-shell').evaluate(el => getComputedStyle(el).marginLeft), '240px');
  await page.mouse.up(); await expectStored(240);
  assert(await page.locator('#draftBar').isHidden());
  await page.waitForTimeout(260); await handle.dblclick(); await expectStored(180);
  await begin(); await move(-200); await page.mouse.up(); await expectStored(56);
  await begin(); await move(700); await page.mouse.up(); await expectStored(280);
  await handle.focus(); await page.keyboard.press('Home'); await expectStored(56);
  assert.equal(await page.locator('#sidebar').getAttribute('data-wide'), 'false');
  await page.keyboard.press('End'); await expectStored(280);
  await page.keyboard.press('Shift+ArrowLeft'); await expectStored(256);
  const count = await page.evaluate(() => fixture.writes.length);
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await expectStored(224); assert.equal(await page.evaluate(() => fixture.writes.length), count + 1);
  await page.evaluate(() => fixture.external(127)); assert.equal(await page.locator('#sidebar').getAttribute('data-wide'), 'false');
  await page.keyboard.press('ArrowRight'); await expectStored(135); assert.equal(await page.locator('#sidebar').getAttribute('data-wide'), 'true');
  // Escape/blur/cancel leave no partial preference, and cancel adopts a concurrent committed value.
  await begin(); await move(200); await page.keyboard.press('Escape'); await page.mouse.up(); assert.equal(await width(), 135); assert.equal(await stored(), 135);
  await begin(); await move(220); await page.evaluate(() => fixture.external(190)); assert.equal(await width(), 220);
  await page.keyboard.press('Escape'); await page.mouse.up(); assert.equal(await width(), 190);
  await begin(); await move(230); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up(); assert.equal(await width(), 190);
  await begin(); await move(230); await handle.dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up(); assert.equal(await width(), 190);
  await begin(); await move(230); await page.evaluate(() => fixture.external(200)); await page.mouse.up(); await expectStored(230);
  // Resizing and bookmark dragging cannot start each other; post-drag clicks are swallowed.
  await page.evaluate(() => document.body.classList.add('dragging'));
  await begin(); assert.equal(await page.locator('body').evaluate(el => el.classList.contains('resizing-sidebar')), false); await page.mouse.up();
  await page.evaluate(() => document.body.classList.remove('dragging'));
  await drag(240); await page.locator('.nav-group').first().evaluate(el => el.click()); assert.equal(await page.evaluate(() => fixture.clicks), 0);
  await page.waitForTimeout(260);
  await page.mouse.click(240, 150, { button: 'right' }); assert.equal(await page.locator('body').evaluate(el => el.classList.contains('resizing-sidebar')), false);
  // A remote commit after ours, but before our storage promise settles, still synchronizes.
  await page.evaluate(() => { fixture.remoteAfterWrite = 210; });
  await begin(); await move(250); await page.mouse.up(); await expectStored(210); assert.equal(await width(), 210);
  // Desktop constraints are temporary; mobile drawer never overwrites a desktop preference.
  await page.evaluate(() => fixture.external(280));
  await page.setViewportSize({ width: 700, height: 800 }); await page.waitForFunction(() => document.querySelector('#sidebarResize').getAttribute('aria-valuenow') === '245'); assert.equal(await stored(), 280);
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForFunction(() => document.querySelector('#sidebarResize').getAttribute('aria-valuenow') === '280');
  await mkdir('.wrangler/extension-sidebar', { recursive: true });
  for (const viewport of [{width:1280,height:800}, {width:820,height:500}, {width:390,height:700}, {width:320,height:500}]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(60);
    if (viewport.width <= 600) {
      assert(await handle.isHidden()); assert.equal(await handle.getAttribute('tabindex'), '-1');
      await page.locator('#sidebar').evaluate(el => el.classList.add('open'));
      assert.equal(await page.locator('#sidebar').evaluate(el => el.getBoundingClientRect().width), 240);
    }
    const row = page.locator('.nav-row').first();
    const label = await row.locator('.nav-label').boundingBox(), lock = await row.locator('.nav-private').boundingBox(), more = await row.locator('.nav-more').boundingBox();
    assert(label.x + label.width <= lock.x && lock.x + lock.width <= more.x, 'text, Private and More never overlap');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert(await page.locator('#groups').evaluate(el => el.scrollHeight > el.clientHeight));
    await page.screenshot({ path: '.wrangler/extension-sidebar/' + viewport.width + '.png' });
  }
  assert.equal(await stored(), 280);
  await page.setViewportSize({width:1280,height:800}); await page.waitForTimeout(60);
  await page.setViewportSize({width:600,height:500}); await page.waitForTimeout(60); assert(await handle.isHidden());
  await page.setViewportSize({width:601,height:500}); await page.waitForTimeout(60); assert(await handle.isVisible()); assert.equal(await width(), 210);
  await page.setViewportSize({width:1280,height:800}); await page.waitForTimeout(60); assert.equal(await width(), 280);
  for (const invalid of [null, -10, 999, '220', NaN]) { await page.evaluate(value => fixture.external(value), invalid); assert.equal(await width(), 180); }
  await page.evaluate(() => { fixture.external(180); fixture.fail = true; });
  await begin(); await move(220); await page.mouse.up();
  await page.waitForFunction(() => fixture.messages.some(text => text.includes('宽度未能记住')));
  assert.equal(await width(), 220); assert.equal(await stored(), 180);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ok:true, pointerAndKeyboard:true, cancelAndConcurrentPreference:true, localPreferenceOnly:true, constraintsAndMobile:true, longLabelsAndPrivate:true, storageFailure:true}));
} finally { await browser.close(); }
