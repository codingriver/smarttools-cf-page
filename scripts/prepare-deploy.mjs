import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

console.log(`Prepared ${publicEntries.length} public entries in ${outputDirectory}`);
