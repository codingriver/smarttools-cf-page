import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const snapshotBody = `window.__siteConfig = { title: "Inline Snapshot" };\n` +
  `window.__viewerInfo = { isAdminView: false };\n` +
  `var sections = [{ key: "inline_fixture", kind: "card", label: "Inline", visible: true, cards: [` +
  `{ type: "simple", title: "Inline </script> Snapshot", url: "https://example.com" }] }];\n`;

const server = http.createServer((request, response) => {
  if (request.url === '/api/data') {
    response.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      ETag: 'W/"build-acceptance"'
    });
    response.end(snapshotBody);
    return;
  }
  response.writeHead(404).end();
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const address = server.address();
  const snapshotUrl = `http://127.0.0.1:${address.port}/api/data`;
  const child = spawn(process.execPath, ['scripts/prepare-deploy.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, SMARTTOOLS_SNAPSHOT_URL: snapshotUrl },
    stdio: 'inherit'
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert(exitCode === 0, `build exited with code ${exitCode}`);
} finally {
  await new Promise(resolve => server.close(resolve));
}

const dist = path.resolve('dist');
const [index, config, headers, routes, dataFunction, extensionPopupHtml, extensionPopupJs, cacheInvalidators] = await Promise.all([
  fs.readFile(path.join(dist, 'index.html'), 'utf8'),
  fs.readFile(path.join(dist, 'config.html'), 'utf8'),
  fs.readFile(path.join(dist, '_headers'), 'utf8'),
  fs.readFile(path.join(dist, '_routes.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.resolve('functions/api/data.js'), 'utf8'),
  fs.readFile(path.join(dist, 'extensions/open-tabs-importer/popup.html'), 'utf8'),
  fs.readFile(path.join(dist, 'extensions/open-tabs-importer/popup.js'), 'utf8'),
  Promise.all(['save.js', 'comment.js', 'source.js', 'site-config.js', 'backups.js']
    .map(file => fs.readFile(path.resolve('functions/api', file), 'utf8')))
]);

assert(index.includes('data-inline-data="1"'), 'inline snapshot marker missing');
assert(index.includes('data-etag="W/&quot;build-acceptance&quot;"'), 'inline snapshot ETag missing');
assert(index.includes('Inline <\\/script> Snapshot'), 'inline snapshot was not script-safe');
assert(index.includes('__SmartToolsDataRefresh') && index.includes('__favPageReloadData'), 'background data correction missing');
assert(index.includes('smarttools:public-data-cache:v1') && index.includes('PUBLIC_DATA_CACHE_TTL_MS'), 'homepage public data local cache missing');

for (const reference of [
  'shared/emoji-data.js',
  'shared/csv-schema.js',
  'shared/xlsx-adapter.js',
  'shared/zip-adapter.js'
]) {
  const content = await fs.readFile(path.join(dist, reference));
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 8);
  assert(config.includes(`${reference}?v=${hash}`), `fingerprint missing for ${reference}`);
}

for (const reference of ['shared/note-modal.js', 'shared/note-modal.css']) {
  const content = await fs.readFile(path.join(dist, reference));
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 8);
  assert(index.includes(`${reference}?v=${hash}`), `fingerprint missing for ${reference}`);
}

assert(/\/shared\/\*\s+Cache-Control: public, max-age=31536000, immutable/.test(headers), 'shared immutable cache rule missing');
assert(/\/extensions\/\*\s+Cache-Control: public, max-age=31536000, immutable/.test(headers), 'extensions immutable cache rule missing');
assert(!routes.include.includes('/*') && !routes.include.includes('/'), 'homepage is still routed through Pages Functions');
assert(dataFunction.includes('public, max-age=31536000, s-maxage=86400, stale-while-revalidate=31536000'), 'public data cache policy is not optimized');
assert(extensionPopupHtml.includes('id="importActive"') && extensionPopupHtml.includes('收藏当前页'), 'current-page import button missing from extension popup');
assert(extensionPopupJs.includes("query = { active: true, currentWindow: true }"), 'current-page import does not query only the active tab');
assert(extensionPopupJs.includes("importTabs('active')"), 'current-page import button is not bound to active import');
assert(cacheInvalidators.every(source => source.includes('invalidatePublicDataCache')), 'a data mutation route does not invalidate the public cache');

console.log(JSON.stringify({
  ok: true,
  inlineSnapshot: true,
  backgroundCorrection: true,
  fingerprintedAssets: 6,
  immutableCacheRules: 2,
  currentPageImportButton: true,
  homepageStaticRoute: true,
  publicDataCacheInvalidation: true
}, null, 2));
