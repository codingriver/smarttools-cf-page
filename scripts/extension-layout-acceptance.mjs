import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';

// Synthetic UI fixture: execute the real disclosure/render module, without RPC or private data.
const root = 'extensions/open-tabs-importer/';
const html = (await readFile(root + 'home.html', 'utf8'))
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace('<link rel="stylesheet" href="home.css">', '');
const css = await readFile(root + 'home.css', 'utf8') + await readFile(root + 'account.css', 'utf8');
const browser = await chromium.launch({ executablePath: process.env.EXTENSION_CHROME_PATH || chromium.executablePath(), headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(html);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: (await readFile(root + 'account-component.js', 'utf8')) + (await readFile(root + 'cache-menu.js', 'utf8')) + `
    mountAccount(document.querySelector('#accountHost'));
    bindCacheMenu(document.querySelector('#accountMenu'));
    window.renderFixture = loggedIn => renderAccountMenu(document.querySelector('#accountMenu'), { loggedIn, busy: false });
  ` });
  await mkdir('.wrangler/extension-layout', { recursive: true });
  for (const width of [1280, 1047, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const loggedIn of [true, false]) {
      await page.evaluate(loggedIn => {
        window.renderFixture(loggedIn);
        document.querySelector('#session').textContent = loggedIn ? '管理员会话 · kv' : '未登录 · 本机缓存／公开数据只读';
        document.querySelector('#cacheInfo').textContent = '本机缓存 · 最后同步 2026/9/28 14:30:00';
      }, loggedIn);
      assert.equal(await page.locator('#siteForm').isVisible(), false, 'forms start collapsed');
      assert.equal(await page.locator('#accountLabel').innerText(), loggedIn ? '管理员' : '登录');
      assert.equal(await page.locator('#accountAvatar').isVisible(), loggedIn);
      const trigger = await page.locator('#accountTrigger').boundingBox();
      assert(trigger.x + trigger.width > width - 30, 'account entry is at the right edge');
      await page.locator('#accountTrigger').focus();
      await page.keyboard.press('Enter');
      assert(await page.locator('#siteUrl').isVisible());
      assert.equal(await page.locator('#loginForm').isVisible(), !loggedIn);
      assert.equal(await page.locator('#logout').isVisible(), loggedIn);
      assert.equal(await page.locator('#clearCache').isVisible(), false);
      await page.locator('.cache-menu summary').click();
      assert(await page.locator('#clearCache').isVisible());
      assert(await page.locator('#clearAllCache').isVisible());
      assert.match(await page.locator('.cache-panel').innerText(), /退出登录不会删除本机缓存/);
      const panel = await page.locator('.account-panel').boundingBox();
      assert(panel.x >= 0 && panel.x + panel.width <= width && panel.y + panel.height <= 900, `popover fits viewport at ${width}`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal overflow at ${width}`);
      await page.locator('#clearCache').click();
      assert.equal(await page.locator('#clearCache').evaluate(button => button.form), null);
      assert(await page.locator('#accountMenu').evaluate(menu => menu.open), 'inside button click keeps popover open');
      await page.locator('.cache-panel p').click();
      assert(await page.locator('#accountMenu').evaluate(menu => menu.open), 'inside text click keeps popover open');
      if ([1047, 390].includes(width)) {
        await page.screenshot({ path: `.wrangler/extension-layout/${width}-${loggedIn ? 'account' : 'login'}.png` });
      }
      if (!loggedIn) await page.locator('#password').fill('unsent-fixture-only');
      await page.locator('header').click({ position: { x: 5, y: 5 } });
      assert.equal(await page.locator('#siteForm').isVisible(), false, 'outside blank click closes popover');
      await page.waitForFunction(() => !document.querySelector('.cache-menu').open && document.querySelector('#password').value === '');
      await page.locator('#accountTrigger').click();
      await page.locator('#siteUrl').click();
      assert(await page.locator('#siteUrl').evaluate(input => document.activeElement === input), 'inside form remains interactive');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#siteForm').isVisible(), false, 'Escape dismisses popover');
      assert(await page.locator('#accountTrigger').evaluate(el => el === document.activeElement), 'Escape restores focus');
      if (width >= 820) {
        await page.locator('#accountTrigger').click();
        await page.locator('#search').click({ position: { x: 5, y: 5 } });
        assert.equal(await page.locator('#siteForm').isVisible(), false, 'outside control dismisses popover');
        assert(await page.locator('#search').evaluate(el => el === document.activeElement), 'outside interaction not blocked');
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 500 });
  await page.evaluate(() => window.renderFixture(false));
  await page.locator('#accountTrigger').click();
  await page.locator('.cache-menu summary').click();
  await page.locator('#clearAllCache').click();
  const panel = await page.locator('.account-panel').boundingBox();
  assert(panel.y + panel.height <= 500, 'short-screen popover stays on screen and scrolls to actions');
  console.log('Extension account popover passed: 5 widths, login/avatar states, site forms, nested cache controls, outside click, Escape, password clearing and short-screen scrolling.');
} finally {
  await browser.close();
}
