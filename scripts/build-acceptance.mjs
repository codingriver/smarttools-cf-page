import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const acceptanceRoot = path.resolve('.wrangler');
await fs.mkdir(acceptanceRoot, { recursive: true });
const acceptanceOutput = await fs.mkdtemp(path.join(acceptanceRoot, 'build-acceptance-'));
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
    env: {
      ...process.env,
      SMARTTOOLS_SNAPSHOT_URL: snapshotUrl,
      SMARTTOOLS_BOOKMARKS_MODE: 'legacy',
      SMARTTOOLS_INLINE_SNAPSHOT: '1',
      SMARTTOOLS_OUTPUT_DIR: path.relative(process.cwd(), acceptanceOutput),
      SMARTTOOLS_OUTPUT_CLEAN: '0'
    },
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

const dist = acceptanceOutput;
const [index, config, headers, routes, dataFunction, extensionPopupHtml, extensionPopupJs, cacheInvalidators, accountSecuritySources] = await Promise.all([
  fs.readFile(path.join(dist, 'index.html'), 'utf8'),
  fs.readFile(path.join(dist, 'config.html'), 'utf8'),
  fs.readFile(path.join(dist, '_headers'), 'utf8'),
  fs.readFile(path.join(dist, '_routes.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.resolve('functions/api/data.js'), 'utf8'),
  fs.readFile(path.join(dist, 'extensions/open-tabs-importer/popup.html'), 'utf8'),
  fs.readFile(path.join(dist, 'extensions/open-tabs-importer/popup.js'), 'utf8'),
  Promise.all(['save.js', 'comment.js', 'source.js', 'site-config.js', 'backups.js']
    .map(file => fs.readFile(path.resolve('functions/api', file), 'utf8'))),
  Promise.all([
    'functions/_shared/auth-v2.js',
    'functions/api/v2/auth/login.js',
    'functions/api/v2/auth/session.js',
    'functions/api/v2/auth/logout.js'
  ].map(file => fs.readFile(path.resolve(file), 'utf8')))
]);

assert(index.includes('data-inline-data="1"'), 'inline snapshot marker missing');
assert(index.includes('data-etag="W/&quot;build-acceptance&quot;"'), 'inline snapshot ETag missing');
assert(index.includes('Inline <\\/script> Snapshot'), 'inline snapshot was not script-safe');
assert(index.includes('data-build-output="fav-page-inline"'), 'homepage runtime was not inlined');
assert(!index.includes('src="shared/fav-page.js"'), 'homepage still references the cacheable external runtime');
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

for (const route of ['/', '/index.html', '/sw.js']) {
  const rule = headers.split(/\r?\n\r?\n/).find(block => block.split(/\r?\n/)[0] === route);
  assert(rule && /Cache-Control: (?:public, )?no-cache/.test(rule), `${route} must revalidate instead of retaining old code`);
  assert(!rule.includes('immutable'), `${route} must not use immutable caching`);
}
assert(index.includes("updateViaCache: 'none'"), 'service worker update must bypass HTTP cache');

assert(/\/shared\/\*\s+Cache-Control: public, max-age=31536000, immutable/.test(headers), 'shared immutable cache rule missing');
assert(/\/extensions\/\*\s+Cache-Control: public, max-age=31536000, immutable/.test(headers), 'extensions immutable cache rule missing');
assert(!routes.include.includes('/*') && routes.include.includes('/') && routes.include.includes('/sw.js'), 'retirement mode requires exact homepage and SW routes');
assert(dataFunction.includes('public, max-age=31536000, s-maxage=86400, stale-while-revalidate=31536000'), 'public data cache policy is not optimized');
assert(extensionPopupHtml.includes('id="importActive"') && extensionPopupHtml.includes('收藏当前页'), 'current-page import button missing from extension popup');
assert(extensionPopupJs.includes("query = { active: true, currentWindow: true }"), 'current-page import does not query only the active tab');
assert(extensionPopupJs.includes("importTabs('active')"), 'current-page import button is not bound to active import');
const extensionDirectory = path.join(dist, 'extensions/open-tabs-importer');
const extensionManifest = JSON.parse(await fs.readFile(path.join(extensionDirectory, 'manifest.json'), 'utf8'));
assert(extensionManifest.version === '1.2.0', 'extension version mismatch');
assert(extensionManifest.name === '栖页 · 书签桌面', 'extension list brand');
assert(extensionManifest.action.default_title === '栖页 · 书签桌面', 'toolbar brand');
assert(extensionPopupHtml.includes('<title>栖页</title>') && extensionPopupHtml.includes('<h1>栖页</h1>'), 'popup brand');
assert(extensionPopupJs.includes('qiye-tabs-${') && !extensionPopupJs.includes('smarttools-tabs-${'), 'export filename brand');
assert(extensionPopupJs.includes('<TITLE>栖页书签</TITLE>') && extensionPopupJs.includes('<H1>栖页书签</H1>'), 'bookmark HTML brand');
for (const [file, expected] of [
  ['cache-db.js', "const DB_NAME = 'smarttools-confirmed-cache'"],
  ['client.js', "channel: 'smarttools-client'"],
  ['site.js', "https://smarttools-4xj.pages.dev/config.html"],
  ['pending-import.js', "source: 'smarttools-open-tabs-extension'"],
  ['cache-controller.js', "id: 'smarttools-root', title: '收藏到栖页'"]
]) assert((await fs.readFile(path.join(extensionDirectory, file), 'utf8')).includes(expected), 'rename compatibility: ' + file);

assert(JSON.stringify(extensionManifest.permissions) === JSON.stringify(['tabs', 'scripting', 'storage', 'contextMenus']), 'extension permission mismatch');
for (const file of ['bookmark-document.js', 'legacy-convert.js', 'start.html', 'start.js', 'start.css', 'draft-actions.js', 'library-editing.js', 'editor-dialog.js', 'desktop-drag.js', 'sidebar-resize.js', 'account-component.js', 'account.css', 'navigation.js', 'view-utils.js', 'fonts/FjallaOne-Regular.ttf', 'fonts/OFL.txt', 'client.js', 'cache-db.js', 'cache-controller.js', 'menu-model.js', 'model.js', 'site.js']) {
  assert((await fs.stat(path.join(extensionDirectory, file))).isFile(), `missing local extension resource: ${file}`);
}
for (const obsolete of ['home.html', 'home.js', 'home.css']) {
  assert(await fs.access(path.join(extensionDirectory, obsolete)).then(() => false, error => error.code === 'ENOENT'), `removed manager resource shipped: ${obsolete}`);
}
assert(!extensionPopupHtml.includes('id="openHome"'), 'removed manager entry must not ship');
for (const pageName of ['start']) {
    const html = await fs.readFile(path.join(extensionDirectory, pageName + '.html'), 'utf8');
    assert(!/<(?:script|iframe)[^>]+(?:src=["']https?:|srcdoc=)/i.test(html), 'no remote executable or embedded website');
    const js = await fs.readFile(path.join(extensionDirectory, pageName + '.js'), 'utf8');
    assert(!/new Function|\beval\s*\(/.test(js), 'MV3 pages do not execute strings');
  }
  assert(!extensionManifest.chrome_url_overrides, 'browsing homepage does not replace new tabs');
  for (const excluded of ['DESIGN.md', '.wrangler', 'scripts']) assert(!(await fs.stat(path.join(dist, excluded)).catch(() => null)), 'research and tests excluded from release');
  assert(extensionManifest.web_accessible_resources === undefined, 'management/cache resources must not be web-accessible');

assert(cacheInvalidators.every(source => source.includes('invalidatePublicDataCache')), 'a data mutation route does not invalidate the public cache');
assert((await fs.readFile(path.join(dist, 'account.html'), 'utf8')).includes('服务端账户配置'), 'static account configuration missing from build');
assert(!(await fs.access(path.join(dist,'shared','account-maintenance.js')).then(()=>true,()=>false)), 'retired account-maintenance script must not ship');
assert(!config.includes('PASSWORD_RECOVERY_TOKEN='), 'recovery token assignment leaked into the admin build');
assert(accountSecuritySources.every(source => !/console\.(?:log|debug|info)\s*\(/.test(source)), 'v2 auth logs sensitive request data');

console.log(JSON.stringify({
  ok: true,
  inlineSnapshot: true,
  backgroundCorrection: true,
  fingerprintedAssets: 6,
  immutableCacheRules: 2,
  currentPageImportButton: true,
  homepageModeGuard: true,
  publicDataCacheInvalidation: true,
  staticAccountGuide: true,
  sensitiveLogging: false
}, null, 2));
