import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const fixture = path.join('.wrangler', 'build-v2-acceptance');
const run = spawnSync(process.execPath, ['scripts/prepare-deploy.mjs'], { encoding: 'utf8', env: { ...process.env, QIYE_OUTPUT_DIR: fixture } });
assert.equal(run.status, 0, run.stderr);
const files = await readdir(fixture);
assert.deepEqual(files, ['_routes.json']);
assert.deepEqual(JSON.parse(await readFile(path.join(fixture, '_routes.json'), 'utf8')), { version:1, include:['/*'], exclude:[] });
const denied = spawnSync(process.execPath, ['scripts/prepare-deploy.mjs'], { encoding:'utf8', env: { ...process.env, QIYE_OUTPUT_DIR: path.resolve(process.cwd(), '..', 'outside-build') } });
assert.notEqual(denied.status, 0);
console.log('PASS API-only build and output guard');

// Naming contract: package, deploy target, client defaults and release instructions agree.
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert.equal(pkg.name, 'qiye');
assert.equal(lock.name, pkg.name);
assert.equal(lock.packages[''].name, pkg.name);
assert.match(pkg.scripts.deploy, /--project-name qiye(?:\s|$)/);
const { DEFAULT_CONFIG_URL } = await import('../extensions/qiye/site.js');
assert.equal(DEFAULT_CONFIG_URL, 'https://qiye.pages.dev');
assert.match(await readFile('extensions/qiye/cache-db.js', 'utf8'), /DB_NAME = 'qiye-confirmed-cache'/);
assert.match(await readFile('.agents/skills/qiye-release/SKILL.md', 'utf8'), /name: qiye-release/);
console.log('PASS qiye naming and package/deploy consistency');
