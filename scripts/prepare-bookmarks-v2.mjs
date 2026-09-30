import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDocument, MAX_BYTES } from '../extensions/open-tabs-importer/bookmark-document.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function prepareCandidate(document) {
  validateDocument(document);
  return { document, etag: '"' + randomUUID() + '"' };
}
async function main(args) {
  if (!((args.length === 3 && args[0] === '--empty' && args[1] === '--output') ||
        (args.length === 4 && args[0] === '--input' && args[2] === '--output')))
    throw new Error('Use --empty --output <directory> or --input <v2.json> --output <directory>');
  const empty = args[0] === '--empty';
  const output = path.resolve(empty ? args[2] : args[3]);
  const parent = await realpath(path.dirname(output));
  if (parent === root || parent.startsWith(root + path.sep)) throw new Error('Output must be outside the repository');
  let document;
  if (empty) document = { schemaVersion: 2, updatedAt: 0, roots: [] };
  else {
    const source = path.resolve(args[1]);
    const raw = await readFile(source);
    if (raw.length > MAX_BYTES) throw new Error('Input exceeds 20 MiB');
    document = JSON.parse(raw.toString('utf8'));
  }
  const value = prepareCandidate(document);
  await mkdir(output); // No recursive creation or overwrite of existing directory.
  await writeFile(path.join(output, 'candidate.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Wrote v2 initialization candidate outside repository; no remote KV writes.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(() => { console.error('Initialization failed: check input schema and output path. No remote writes.'); process.exitCode = 1; });
