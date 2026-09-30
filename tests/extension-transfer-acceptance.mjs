import assert from 'node:assert/strict';
import { fixture } from './bookmarks-v2-fixture.mjs';
import { MAX_BYTES, emptyDocument } from '../extensions/qiye/bookmark-document.js';
import { parseBookmarkJson, readBookmarkFile, exportBookmarkJson, prepareImportedDraft, importDescription } from '../extensions/qiye/bookmark-transfer.js';
const original = fixture();
assert.deepEqual(parseBookmarkJson(exportBookmarkJson(original)), original);
assert.deepEqual(parseBookmarkJson('\uFEFF' + JSON.stringify(original)), original);
assert.deepEqual(parseBookmarkJson(exportBookmarkJson(emptyDocument())), emptyDocument());
assert.match(importDescription(original), /个分类/);
for (const text of ['', '{', 'null', '[]', 'var sections = [];', JSON.stringify({ document: original }), JSON.stringify({ sections: [] })]) assert.throws(() => parseBookmarkJson(text));
for (const mutate of [
 d => delete d.updatedAt, d => d.updatedAt = '1', d => d.updatedAt = -1, d => d.schemaVersion = 1,
 d => d.roots = {}, d => d.extra = true, d => d.roots.push(d.roots[0]),
 d => delete d.roots[0].children, d => d.roots[0].isPrivate = 'false', d => d.roots[0].visible = 'true',
 d => d.roots[0].id = '', d => d.roots[0].title = ' ', d => d.roots[0].type = 'unknown',
 d => d.roots[0].updatedAt = 1, d => d.roots[0].children[0].url = 'javascript:alert(1)',
 d => d.roots[0].children[0].url = 'data:text/html,unsafe', d => d.roots[0].children[0].desc = {},
 d => d.roots[0].children[0].children = [], d => d.roots[0].children[0].isPrivate = true,
 d => { delete d.roots[0].children[0].url; },
 d => { let node = d.roots[0]; for (let i = 0; i < 32; i++) { const child = { id: 'nested-' + i, type: 'folder', title: 'nested', isPrivate: false, visible: true, children: [] }; node.children.push(child); node = child; } }
]) { const invalid = structuredClone(original); mutate(invalid); assert.throws(() => parseBookmarkJson(JSON.stringify(invalid))); }
let read = false;
await assert.rejects(readBookmarkFile({ name: 'large.json', size: MAX_BYTES + 1, text: () => { read = true; } }), /20 MiB/); assert(!read);
await assert.rejects(readBookmarkFile({ name: 'unsafe.js', size: 1, text: () => { read = true; } }), /\.json/); assert(!read);
await assert.rejects(readBookmarkFile({ name: 'broken.json', size: 1, text: async () => { throw Error('synthetic'); } }), /无法读取/);
await assert.rejects(readBookmarkFile({ name: 'lying-size.json', size: 1, text: async () => ' '.repeat(MAX_BYTES + 1) }), /20 MiB/);
assert.deepEqual(await readBookmarkFile({ name: 'BOOKMARKS.JSON', size: 1, text: async () => JSON.stringify(original) }), original);
const imported = structuredClone(original); imported.updatedAt = 9999999999999; imported.roots[0].title = 'Imported';
const draft = prepareImportedDraft(imported, original); assert(draft.dirty); assert.equal(draft.document.updatedAt, original.updatedAt); assert.equal(imported.updatedAt, 9999999999999); assert.equal(original.roots[0].title, 'Daily');
assert(!prepareImportedDraft({ ...original, updatedAt: 9999999999999 }, original).dirty);
assert.deepEqual(draft.document.roots[0].children, imported.roots[0].children);
const nearLimit = emptyDocument(); nearLimit.roots.push({ id: 'large', type: 'folder', title: 'large', isPrivate: false, visible: true, children: [], extensions: { payload: '' } });
nearLimit.roots[0].extensions.payload = 'x'.repeat(MAX_BYTES - new TextEncoder().encode(JSON.stringify(nearLimit)).byteLength);
const exported = exportBookmarkJson(nearLimit); assert.equal(new TextEncoder().encode(exported).byteLength, MAX_BYTES); assert.deepEqual(parseBookmarkJson(exported), nearLimit);
console.log('PASS JSON transfer: round-trip, required fields, IDs, depth, unsafe URLs, size-before-read, cancel-safe pure preparation and confirmed timestamp');
