import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
export async function selectBookmarkFile(page, value, { accept = true, raw = false, pattern = /JSON 已导入/ } = {}) {
  await page.locator('#accountMenu').evaluate(node => { node.open = true; });
  if (!raw) page.once('dialog', async dialog => { assert.match(dialog.message(), /不会合并/); await (accept ? dialog.accept() : dialog.dismiss()); });
  const chooser = page.waitForEvent('filechooser'); await page.locator('#importBookmarks').click();
  await (await chooser).setFiles({ name: 'synthetic-bookmarks.json', mimeType: 'application/json', buffer: Buffer.from(raw ? value : JSON.stringify(value)) });
  await page.locator('#status').filter({ hasText: pattern }).waitFor();
}
export async function testBookmarkTransfer({ first, second, snap, idle }) {
  const baseline = await snap(first), imported = structuredClone(baseline.document);
  imported.updatedAt = 9999999999999; imported.roots[0].children[0].title = 'Imported draft';
  await selectBookmarkFile(first, imported);
  assert(await first.locator('#draftBar').isVisible()); assert.deepEqual(await snap(first), baseline);
  assert.equal(await second.locator('#cards .tile-title').first().innerText(), 'Docs');
  // Export only confirmed data, not the draft; all hidden/Private nodes survive round-trip.
  await first.locator('#accountTrigger').click();
  first.once('dialog', async dialog => { assert.match(dialog.message(), /未加密/); await dialog.accept(); });
  const pendingDownload = first.waitForEvent('download'); await first.locator('#exportBookmarks').click();
  const download = await pendingDownload; assert.match(download.suggestedFilename(), /^qiye-bookmarks-.*\.json$/);
  assert.deepEqual(JSON.parse(await readFile(await download.path(), 'utf8')), baseline.document);
  await selectBookmarkFile(first, '{bad json', { raw: true, pattern: /不是有效的 JSON/ });
  assert.equal(await first.locator('#cards .tile-title').first().innerText(), 'Imported draft');
  assert.deepEqual(await snap(first), baseline);
  await selectBookmarkFile(first, baseline.document, { accept: false, pattern: /已取消导入/ });
  assert.equal(await first.locator('#cards .tile-title').first().innerText(), 'Imported draft');
  // Selecting the same file again is supported; a timestamp-only change is not a business edit.
  await selectBookmarkFile(first, { ...baseline.document, updatedAt: 9999999999999 }, { pattern: /无需保存/ });
  assert(await first.locator('#draftBar').isHidden()); assert.deepEqual(await snap(first), baseline);
  // A connectivity change while File.text() is pending must cancel without replacing data.
  await first.evaluate(() => { window.originalFileText = File.prototype.text; File.prototype.text = function () { return new Promise(resolve => { window.releaseImport = async () => resolve(await originalFileText.call(this)); }); }; });
  await first.locator('#accountMenu').evaluate(node => { node.open = true; });
  await first.locator('#bookmarkFile').setInputFiles({ name: 'delayed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await first.waitForFunction(() => !!window.releaseImport);
  await first.evaluate(() => { window.dispatchEvent(new Event('offline')); window.releaseImport(); File.prototype.text = originalFileText; });
  await first.locator('#status').filter({ hasText: /本次导入已取消/ }).waitFor();
  assert(await first.locator('#draftBar').isHidden()); assert.deepEqual(await snap(first), baseline);
  assert(await first.locator('#importBookmarks').isDisabled()); assert(await first.locator('#exportBookmarks').isEnabled());
  await first.locator('#checkConnection').click(); await idle(first); await first.keyboard.press('Escape');
  assert.equal(await first.locator('#cards .tile-title').first().innerText(), 'Docs');
}
