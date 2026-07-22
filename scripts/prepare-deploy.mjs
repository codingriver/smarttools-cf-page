import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(projectRoot, 'dist');
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
  'shared'
];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const entry of publicEntries) {
  await cp(
    path.join(projectRoot, entry),
    path.join(outputDirectory, entry),
    { recursive: true }
  );
}

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
