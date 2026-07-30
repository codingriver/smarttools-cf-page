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

assert(index.includes('data-build-output="fav-page-inline"'), 'deployment blocked: inline homepage runtime is missing');
assert(index.includes('data-inline-data="1"'), 'deployment blocked: production public data snapshot is missing');
assert(index.includes('window.__viewerInfo'), 'deployment blocked: public viewer metadata is missing');

console.log(JSON.stringify({
  ok: true,
  deployDirectory: path.dirname(indexPath),
  testFixturesAbsent: true,
  productionSnapshotPresent: true
}, null, 2));
