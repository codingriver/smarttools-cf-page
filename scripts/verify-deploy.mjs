import fs from 'node:fs/promises';
import path from 'node:path';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const indexPath = path.resolve('dist/index.html');
const index = await fs.readFile(indexPath, 'utf8');
const forbiddenFixtures = [
  'Inline Snapshot',
  'inline_fixture',
  'build-acceptance'
];

for (const fixture of forbiddenFixtures) {
  assert(!index.includes(fixture), `deployment blocked: test fixture found in dist/index.html: ${fixture}`);
}

const { mode } = JSON.parse(await fs.readFile('dist/bookmark-mode.json', 'utf8'));
assert(mode === (process.env.SMARTTOOLS_BOOKMARKS_MODE || 'legacy'), 'deployment blocked: stale build mode');
if (mode === 'legacy') {
  assert(index.includes('data-build-output="fav-page-inline"'), 'deployment blocked: inline homepage runtime is missing');
  assert(index.includes('data-inline-data="1"'), 'deployment blocked: production public data snapshot is missing');
  assert(index.includes('window.__viewerInfo'), 'deployment blocked: public viewer metadata is missing');
} else {
  assert(['v2','maintenance'].includes(mode), 'deployment blocked: invalid mode');
  assert(index === await fs.readFile('dist/retired.html', 'utf8'), 'deployment blocked: retirement homepage mismatch');
  assert(await fs.readFile('dist/config.html', 'utf8') === index, 'deployment blocked: legacy config still served');
  assert(await fs.readFile('dist/sw.js', 'utf8') === await fs.readFile('dist/retired-sw.js', 'utf8'), 'deployment blocked: old SW still served');
  assert((await fs.readFile('dist/data.js', 'utf8')).trim() === '/* Legacy bookmarks retired. */', 'deployment blocked: old static data still served');
  assert(!index.includes('data-inline-data'), 'deployment blocked: retirement contains snapshot');
  // An explicit release assertion, not a claim that this script can inspect remote bindings.
  assert(process.env.SMARTTOOLS_CONFIRMED_SERVER_MODE === mode, 'deployment blocked: confirm matching server BOOKMARKS_MODE before release');
}
console.log(JSON.stringify({ ok: true, mode, deployDirectory: path.dirname(indexPath), testFixturesAbsent: true, productionSnapshotPresent: mode === 'legacy' }, null, 2));
