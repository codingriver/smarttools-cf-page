import { lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, process.env.SMARTTOOLS_OUTPUT_DIR || 'dist');
const relative = path.relative(root, output).replaceAll('\\', '/');
if (output === root || !output.startsWith(root + path.sep) || !(relative === 'dist' || /^\.wrangler\/build-[a-z0-9-]+$/.test(relative)))
  throw new Error('Output must be dist or a dedicated .wrangler/build-* directory inside repository');
if (process.env.SMARTTOOLS_OUTPUT_CLEAN === '0') throw new Error('Clean build required for API-only deployment');
// Never recurse through a symlinked parent or follow an output symlink outside this workspace.
const parent = path.dirname(output);
const actualParent = await realpath(parent);
if (actualParent !== root && !actualParent.startsWith(root + path.sep)) throw new Error('Build output parent escapes repository');
const existing = await lstat(output).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
if (existing?.isSymbolicLink()) throw new Error('Build output must not be a symlink');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await writeFile(path.join(output, '_routes.json'), JSON.stringify({ version: 1, include: ['/*'], exclude: [] }) + '\n');
console.log('Built Pages v2 API routes (no public assets or remote snapshot)');
