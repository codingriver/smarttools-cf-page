import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(projectRoot, 'dist');

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
await writeFile(builtIndexPath, builtIndex);

console.log(`Prepared ${publicEntries.length} public entries in ${outputDirectory} with inline homepage runtime`);
