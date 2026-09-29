import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { structuredSections } from '../functions/_shared/structured-data.js';
import { convertSections } from '../extensions/open-tabs-importer/legacy-convert.js';
import { entries, validateDocument } from '../extensions/open-tabs-importer/bookmark-document.js';

// Offline maintenance tool, NOT an API or a remote KV writer. Input must be an explicitly
// selected, assembled, administrator backup; never guess between static/split/legacy keys.
export function prepareCandidate(input, now = 0) {
  if (!input || !['static', 'kv'].includes(input.source) || input.view !== 'admin') throw new Error('Expected explicit source (static/kv), view:admin and sections or content');
  if (Array.isArray(input.sections) === (typeof input.content === 'string')) throw new Error('Provide exactly one of sections or literal content');
  const document = convertSections(input.sections || structuredSections(input.content, true), now);
  validateDocument(document);
  const rows = entries(document);
  return { value: { document, etag: '"' + randomUUID() + '"' }, report: { source: input.source, roots: document.roots.length, folders: rows.filter(e => e.node.type === 'folder').length, bookmarks: rows.filter(e => e.node.type === 'bookmark').length, legacy: rows.filter(e => e.node.type === 'legacy').length, privateNodes: rows.filter(e => e.isPrivate).length, opaqueNodes: rows.filter(e => e.node.extensions).length } };
}
async function main() {
  const args = process.argv.slice(2);
  if (!args[0] || ![1,3].includes(args.length) || (args.length === 3 && args[1] !== '--output')) throw new Error('Usage: node scripts/prepare-bookmarks-v2.mjs <selected-admin-backup.json> [--output <NEW directory OUTSIDE repository>]');
  const raw = await readFile(args[0]);
  if (raw.length > 32 * 1024 * 1024) throw new Error('Input exceeds 32 MiB');
  const result = prepareCandidate(JSON.parse(raw.toString('utf8')));
  const report = { ...result.report, sourceSha256: createHash('sha256').update(raw).digest('hex'), warning: 'Ciphertext is discarded; inspect opaque/legacy fields offline before installation. No remote writes performed.' };
  if (args[2]) {
    const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
    const target = path.resolve(args[2]), parent = await realpath(path.dirname(target));
    const relative = path.relative(root, parent);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Private migration artifacts must stay outside the repository');
    const output = path.join(parent, path.basename(target));
    await mkdir(output); // Never overwrite a previous candidate or backup.
    await writeFile(path.join(output, 'source-backup.json'), raw, { flag:'wx', mode:0o600 });
    await writeFile(path.join(output, 'candidate.json'), JSON.stringify(result.value), { flag:'wx', mode:0o600 });
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { flag:'wx', mode:0o600 });
  }
  console.log(JSON.stringify({ dryRun: !args[2], ...report }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Migration preparation failed; check input schema and output path locally. No remote writes performed.'); process.exitCode = 1; });
