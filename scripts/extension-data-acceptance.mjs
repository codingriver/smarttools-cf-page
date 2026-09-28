import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDataLiteral } from '../functions/_shared/data-literal.js';
import { stripPrivateSections } from '../functions/_shared/data-split.js';
import { structuredSections } from '../functions/_shared/structured-data.js';
import { onRequestGet as data } from '../functions/api/data.js';
import { onRequestPost as save } from '../functions/api/save.js';
import { createToken } from '../functions/_shared/auth.js';
import { deltaPayload, matches, reorder, safeUrl } from '../extensions/open-tabs-importer/model.js';

class MemoryKV {
  values = new Map(); writes = 0; saveKeys = null;
  record(key) {
    if (this.saveKeys?.has(key)) throw new Error("Synthetic KV 429: duplicate write in one save request");
    this.saveKeys?.add(key); this.writes++;
  }
  async get(key) { return this.values.get(key) ?? null; }
  async put(key, value) { this.record(key); this.values.set(key, value); }
  async delete(key) { this.record(key); this.values.delete(key); }
  async list({ prefix }) { return { keys: [...this.values.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; }
}
const group = (key, privateGroup = false) => ({ key, kind: 'card', label: key, visible: true, private: privateGroup, builtin: true, custom: { preserved: true }, cards: [{ id: key + '_card', type: 'expandable', title: key, subCards: [{ content: 'needle', url: '/relative', custom: 42 }] }] });
const initial = [group('a'), group('private_fixture', true)];
const source = sections => 'var sections = ' + JSON.stringify(sections) + ';\n';
const env = { FAV_KV: new MemoryKV(), ADMIN_USER: 'fixture-admin', ADMIN_PASS: 'fixture-password', AUTH_SECRET: '0123456789abcdef0123456789abcdef', ASSETS: { fetch: async () => new Response(source(initial)) } };
const cookie = 'auth=' + await createToken(env.ADMIN_USER, env.AUTH_SECRET);
async function get(admin = true, format = 'structured', target = env) {
  const response = await data({ request: new Request('https://fixture.invalid/api/data?format=' + format, { headers: admin ? { Cookie: cookie } : {} }), env: target });
  return { response, body: await response.json() };
}
async function post(body) {
  env.FAV_KV.saveKeys = new Set();
  try {
    const response = await save({ request: new Request('https://fixture.invalid/api/save', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env });
    return { response, body: await response.json() };
  } finally { env.FAV_KV.saveKeys = null; }
}
assert.equal(structuredSections(await readFile('data.js', 'utf8'), true).length, 6);
assert.deepEqual(JSON.parse(JSON.stringify(parseDataLiteral("{ key: 'x', cards: [], /* ok */ text: '\\u4e2d\\n', }"))), { key: 'x', cards: [], text: '中\n' });
for (const literal of ["{cards: run()}", '{x: undefined}', '{__proto__: {x:1}}', '{x: `interpolation`}', '{x: 1, x: 2}', '[1,,2]', '{x: Infinity}', '{x: 01}', '{x: new Date()}']) assert.throws(() => parseDataLiteral(literal));
assert.throws(() => structuredSections('var sections = [{key:"x",cards:danger()}];', true));
assert.throws(() => structuredSections('var sections = [].concat([]);', true));
assert.throws(() => structuredSections('var sections = []; sections.push({});', true));
assert.equal(structuredSections('/* var sections = []; */' + source(initial), true).length, 2);
const empty = structuredSections('var sections = [// only a comment\n];', false); assert.deepEqual(empty, []);
const malformed = await get(true, 'structured', { ...env, ASSETS: { fetch: async () => new Response("var sections = [{key: 'legacy', encrypted: true, enc: {}}, {label: 'missing key', cards: []}];") } });
assert.equal(malformed.response.status, 422);
assert.equal(structuredSections('var sections = [{encrypted: true, enc: {}}];', true).length, 0);
const staticData = await get(); assert.equal(staticData.body.source, 'static'); assert.equal(staticData.body.sections.length, 2);
assert.match(staticData.response.headers.get('cache-control'), /private.*no-store/);
assert(!stripPrivateSections(source([group('dup'), { ...group('dup', true), label: 'must-not-leak' }])).includes('must-not-leak'));
assert.equal(stripPrivateSections("var sections = [{ key: 'x', private: true, cards: execute() }];"), 'var sections = [];\n');
const publicData = await get(false); assert.equal(publicData.body.sections.length, 1); assert.equal(publicData.body.privateFiltered, true);
assert.equal((await get(true, 'structured', { ...env, FAV_KV: undefined })).body.hasKV, false);
assert.equal((await get(false, 'json')).body.content.includes('private_fixture'), false);
const writeCount = env.FAV_KV.writes;
assert.equal((await post({ ...deltaPayload(initial, initial), baseEtag: staticData.body.dataEtag })).body.code, 'INITIALIZATION_REQUIRED');
assert.equal(env.FAV_KV.writes, writeCount);
let result = await post({ content: source(initial), baseEtag: staticData.body.dataEtag, baseSource: 'static' }); assert.equal(result.response.status, 200);
const baseline = await get(); assert.equal(baseline.body.source, 'kv');
const added = [...baseline.body.sections, group('new_c')];
result = await post({ ...deltaPayload(baseline.body.sections, added), baseEtag: baseline.body.dataEtag, baseSource: 'kv' }); assert.equal(result.response.status, 200);
let count = env.FAV_KV.writes;
const stale = await post({ ...deltaPayload(initial, [group('a')]), baseEtag: baseline.body.dataEtag }); assert.equal(stale.response.status, 409); assert.equal(stale.body.code, 'SAVE_CONFLICT'); assert.equal(env.FAV_KV.writes, count);
assert.equal((await post({ content: source(initial), baseEtag: baseline.body.dataEtag })).response.status, 409); assert.equal(env.FAV_KV.writes, count);
let current = await get(); assert.equal(current.body.sections.length, 3);
const edited = structuredClone(current.body.sections); edited[0].cards[0].title = 'edited'; edited[0].label = 'line\nvar injected = true;'; edited[1].private = false;
result = await post({ ...deltaPayload(current.body.sections, edited), baseEtag: current.body.dataEtag }); assert.equal(result.response.status, 200);
current = await get(); assert.equal(current.body.sections[0].builtin, true); assert.equal(current.body.sections[0].custom.preserved, true); assert.equal(current.body.sections[0].cards[0].subCards[0].custom, 42);
assert.equal((await get(false)).body.sections.length, 3);
assert.equal(current.body.dataEtag, result.body.dataEtag);
result = await post({ ...deltaPayload(current.body.sections, current.body.sections), baseEtag: current.body.dataEtag }); assert.equal(result.body.dataEtag, current.body.dataEtag);
// Removal cleanup and no-op saves also run with a per-request same-key write guard.
const withoutLast = current.body.sections.slice(0, -1);
result = await post({ ...deltaPayload(current.body.sections, withoutLast), baseEtag: current.body.dataEtag });
assert.equal(result.response.status, 200);
current = await get(); assert.equal(current.body.sections.length, 2);
const cleanValues = new Map(env.FAV_KV.values);
const originalPut = env.FAV_KV.put;
env.FAV_KV.put = async () => { throw new Error('synthetic storage failure; must not be exposed'); };
const brokenDraft = structuredClone(current.body.sections); brokenDraft[0].label = 'Storage failure draft';
const failedSave = await post({ ...deltaPayload(current.body.sections, brokenDraft), baseEtag: current.body.dataEtag });
assert.equal(failedSave.response.status, 503); assert.equal(failedSave.body.code, 'SAVE_STORAGE_ERROR');
assert.equal(failedSave.body.outcomeUnknown, true); assert(!JSON.stringify(failedSave.body).includes('must not be exposed'));
assert.equal(failedSave.response.headers.get('set-cookie'), null);
env.FAV_KV.put = originalPut; env.FAV_KV.values = cleanValues;
await env.FAV_KV.put('admin:data_source', 'static'); count = env.FAV_KV.writes;
assert.equal((await post({ content: source(initial), baseEtag: current.body.dataEtag, baseSource: 'kv' })).response.status, 409); assert.equal(env.FAV_KV.writes, count);
assert(matches(initial[0].cards[0], 'needle')); const ordered = [1, 2]; assert(reorder(ordered, 0, 1)); assert.deepEqual(ordered, [2, 1]); assert(!reorder(ordered, 1, 1));
assert.equal(safeUrl('javascript:alert(1)', 'https://fixture.invalid'), null); assert.equal(safeUrl('/path', 'https://fixture.invalid'), 'https://fixture.invalid/path');
console.log(JSON.stringify({ ok: true, singleWritePerKeyPerSave: true, storageFailureJsonNotLogout: true, safeLiteralParser: true, structuredPrivacy: true, staticInitialization: true, staleDeltaAndFullSaveRejectedBeforeWrites: true, unknownFieldsPreserved: true, sourceConflict: true, draftModel: true }));
