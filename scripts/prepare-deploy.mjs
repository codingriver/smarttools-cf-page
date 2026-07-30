import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const requestedOutputDirectory = process.env.SMARTTOOLS_OUTPUT_DIR || 'dist';
const outputDirectory = path.resolve(projectRoot, requestedOutputDirectory);
if (outputDirectory === projectRoot || !outputDirectory.startsWith(projectRoot + path.sep)) {
  throw new Error('SMARTTOOLS_OUTPUT_DIR must stay inside the project directory');
}
const snapshotUrl = process.env.SMARTTOOLS_SNAPSHOT_URL || 'https://www.303066.xyz/api/data';

const publicEntries = [
  '404.html',
  '_headers',
  '_redirects',
  '_routes.json',
  'config.html',
  'data.js',
  'extensions',
  'index.html',
  'robots.txt',
  'shared',
  'sw.js'
];

if (process.env.SMARTTOOLS_OUTPUT_CLEAN !== '0') {
  await rm(outputDirectory, { recursive: true, force: true });
}
await mkdir(outputDirectory, { recursive: true });

// ---- 图标本地化：构建期把公开图标下载到 dist/icons/，改写引用为同域路径 ----
// 下载失败的图标保留原外部 URL，改由运行时浏览器同域代理 /api/icon 兜底（绝不 403）。
const iconMap = new Map();
const iconsDir = path.join(outputDirectory, 'icons');

function extFromUrl(urlString, contentType) {
  try {
    const u = new URL(urlString);
    const base = path.basename(u.pathname.split('?')[0]);
    const m = base.match(/\.([a-zA-Z0-9]+)$/);
    if (m) return '.' + m[1].toLowerCase();
  } catch (_) {}
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('svg')) return '.svg';
  if (ct.includes('png')) return '.png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  if (ct.includes('gif')) return '.gif';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('ico')) return '.ico';
  if (ct.includes('bmp')) return '.bmp';
  return '.img';
}

async function downloadIcon(originalUrl) {
  if (iconMap.has(originalUrl)) return iconMap.get(originalUrl);
  iconMap.set(originalUrl, null); // 占位，避免同一 URL 重复下载
  try {
    await mkdir(iconsDir, { recursive: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(originalUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'SmartTools-Build/1.0', 'Accept': 'image/*,*/*' }
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 5 * 1024 * 1024) return null;
    const ext = extFromUrl(originalUrl, res.headers.get('content-type'));
    const hash = createHash('sha256').update(originalUrl).digest('hex').slice(0, 12);
    const name = hash + ext;
    await writeFile(path.join(iconsDir, name), buf);
    const local = '/icons/' + name;
    iconMap.set(originalUrl, local);
    return local;
  } catch (_) {
    return null;
  }
}

async function localizeIconUrls(text) {
  if (typeof text !== 'string' || !text.includes('iconImg')) return text;
  const re = /(iconImg:\s*['"])(https?:\/\/[^'"]+)(['"])/g;
  const urls = new Set();
  let m;
  while ((m = re.exec(text)) !== null) urls.add(m[2]);
  for (const u of urls) {
    await downloadIcon(u);
  }
  return text.replace(/(iconImg:\s*['"])(https?:\/\/[^'"]+)(['"])/g, (full, pre, u, post) => {
    const local = iconMap.get(u);
    return local ? pre + local + post : full;
  });
}

for (const entry of publicEntries) {
  await cp(
    path.join(projectRoot, entry),
    path.join(outputDirectory, entry),
    { recursive: true }
  );
}

// 把静态兜底 data.js 里的外部图标也下载到本地（KV 为空时的离线回退）
try {
  const dataJsPath = path.join(outputDirectory, 'data.js');
  const dataJs = await readFile(dataJsPath, 'utf8');
  await writeFile(dataJsPath, await localizeIconUrls(dataJs));
} catch (_) {}

const builtIndexPath = path.join(outputDirectory, 'index.html');
const favPageSource = await readFile(path.join(projectRoot, 'shared', 'fav-page.js'), 'utf8');
const { code: favPageInline } = await transform(favPageSource, {
  minify: true,
  target: 'es2020'
});
if (favPageInline.toLowerCase().includes('</script')) throw new Error('fav-page output cannot be safely inlined');
let builtIndex = await readFile(builtIndexPath, 'utf8');
const favPageTag = '<script defer src="shared/fav-page.js" data-build-inline="fav-page"></script>';
if (!builtIndex.includes(favPageTag)) throw new Error('fav-page inline build marker is missing');
builtIndex = builtIndex.replace(favPageTag, '');
builtIndex = builtIndex.replace(
    '</body>',
    `<script data-build-output="fav-page-inline">\n${favPageInline}\n</script>\n</body>`
);

async function fetchInlineSnapshot() {
  if (process.env.SMARTTOOLS_INLINE_SNAPSHOT === '0') return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(snapshotUrl, {
      headers: { Accept: 'application/javascript' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const snapshot = await response.text();
    if (!snapshot.trim() || snapshot.length > 1024 * 1024) return null;
    return {
      content: snapshot.replace(/<\/script/gi, '<\\/script'),
      etag: response.headers.get('etag') || ''
    };
  } catch (error) {
    console.warn(`Skipped inline data snapshot (${snapshotUrl}): ${error?.message || error}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const snapshot = await fetchInlineSnapshot();
if (snapshot) {
  // 把内联快照里的外部图标下载到本地并重写引用
  snapshot.content = await localizeIconUrls(snapshot.content);
}
if (snapshot) {
  const marker = '<!-- 尽早并行请求公开数据；在线响应同时注入站点配置和查看者身份。 -->';
  if (!builtIndex.includes(marker)) throw new Error('homepage data loader marker is missing');
  const snapshotTag =
    `<script data-inline-data="1" data-etag="${escapeHtmlAttribute(snapshot.etag)}">\n` +
    `${snapshot.content}\n</script>`;
  builtIndex = builtIndex.replace(marker, `${snapshotTag}\n\n    ${marker}`);
}
await writeFile(builtIndexPath, builtIndex);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function assetHash(relativePath) {
  const content = await readFile(path.join(outputDirectory, relativePath));
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

async function fingerprintHtml(relativePath) {
  const htmlPath = path.join(outputDirectory, relativePath);
  let html = await readFile(htmlPath, 'utf8');
  const references = new Set(
    [...html.matchAll(/(['"])(shared\/[A-Za-z0-9._-]+\.(?:js|css))(?:\?v=[0-9a-f]+)?\1/g)]
      .map(match => match[2])
  );
  for (const reference of references) {
    const hash = await assetHash(reference);
    const pattern = new RegExp(
      `(['"])${escapeRegExp(reference)}(?:\\?v=[0-9a-f]+)?\\1`,
      'g'
    );
    html = html.replace(pattern, `$1${reference}?v=${hash}$1`);
  }
  await writeFile(htmlPath, html);
  return references.size;
}

const fingerprintedReferenceCount =
  (await fingerprintHtml('index.html')) +
  (await fingerprintHtml('config.html')) +
  (await fingerprintHtml('404.html'));

console.log(
  `Prepared ${publicEntries.length} public entries in ${outputDirectory} ` +
  `with inline homepage runtime, ${fingerprintedReferenceCount} fingerprinted shared asset references` +
  (snapshot ? ' and inline data snapshot' : '')
);
