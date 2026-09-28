import { client, applyClientError, sessionLabel } from '../extensions/open-tabs-importer/client.js';
import assert from 'node:assert/strict';
import { moveItem, canMove, reorderBefore, validateCard, saveDraft } from '../extensions/open-tabs-importer/draft-actions.js';
import { createEditing } from '../extensions/open-tabs-importer/library-editing.js';
const leaf = { id: 'a', title: 'A', url: 'https://example.invalid/a', unknown: { retained: 42 } };
const folder = { id: 'f', title: 'Folder', type: 'expandable', url: 'https://example.invalid/main', subCards: [] };
const empty = { id: 'empty', type: 'expandable', subCards: [] };
const special = { type: 'desc-clickable', title: 'Special interaction', descUrl: '/detail' };
const a = { key: 'a', label: 'Private', kind: 'card', private: true, cards: [leaf, folder, empty, special] };
const b = { key: 'b', label: 'Public', kind: 'card', cards: [] };
const hidden = { key: 'h', visible: false, kind: 'card', cards: [], custom: ['keep'] };
const sections = [a, hidden, b];
assert.equal(canMove(a, empty, null, { section: a, parent: folder }), false, 'empty folders cannot nest');
assert.equal(canMove(a, special, null, { section: a, parent: folder }), false, 'special interaction cannot downgrade');
const before = structuredClone(sections);
assert.equal(moveItem(sections, a, leaf, null, { section: b }, null, () => false), false);
assert.deepEqual(sections, before, 'cancelled Private transfer is mutation-free');
assert(moveItem(sections, a, leaf, null, { section: a, parent: folder }, null, () => true));
assert.equal(leaf.type, 'compact'); assert.equal(folder.subCards[0], leaf); assert.equal(folder.url, 'https://example.invalid/main');
assert(moveItem(sections, a, leaf, folder, { section: b }, null, () => true));
assert.equal(leaf.type, 'simple'); assert.deepEqual(leaf.unknown, { retained: 42 });
assert(reorderBefore(sections, b, a)); assert.equal(sections[1], a); assert.equal(sections[2], hidden);
assert.equal(reorderBefore(sections, b, a), false);
assert.throws(() => moveItem(sections, a, leaf, null, { section: b }), /不支持/);
assert.throws(() => validateCard({ title: 'Unsafe', url: 'javascript:alert(1)' }, {}, 'https://example.invalid'), /URL/);
assert.throws(() => validateCard({ title: 'Folder', type: 'simple' }, { subCards: [leaf] }, 'https://example.invalid'), /子卡片/);
let form, dirty = 0;
const state = { sections, selected: a.key, configUrl: 'https://example.invalid/config.html' };
const edit = createEditing({ state, dialog: (...args) => { form = args; }, changed: () => dirty++ });
globalThis.confirm = () => true;
edit.editGroup(); form[2]({ label: 'New group', visible: true, private: false }); const added = sections.at(-1);
assert.equal(added.label, 'New group');
edit.editCard(added, null, null, true);
const defaults = Object.fromEntries(form[1].map(f => [f.name, f.value || '']));
form[2]({ ...defaults, title: 'Created folder', sectionKey: added.key }); const created = added.cards[0];
assert.equal(created.type, 'expandable');
edit.editCard(added, null, created); form[2]({ title: 'Child', url: 'https://example.invalid/child', custom: 9 });
edit.deleteCard(added, created); form[2]({ target: 'extract' });
assert.equal(added.cards[0].title, 'Child'); assert.equal(added.cards[0].custom, 9);
edit.deleteGroup(added); form[2]({ target: b.key }); assert(!sections.includes(added)); assert.equal(b.cards.at(-1).title, 'Child');
edit.deleteCard(b, b.cards.at(-1)); assert.equal(dirty, 1);
let writes = 0;
const writable = { loggedIn: true, hasKV: true, dirty: true, etag: 'version', configured: 'kv', source: 'kv', sections };
await saveDraft(writable, async (action, payload) => { writes++; assert.equal(action, 'save'); assert.equal(payload.baseEtag, 'version'); assert.equal(payload.initialize, false); });
await assert.rejects(saveDraft({ ...writable, loggedIn: false }, () => writes++));
await assert.rejects(saveDraft({ ...writable, source: 'static' }, () => writes++));
await assert.rejects(saveDraft(writable, () => { writes++; throw new Error('409'); }), /409/);
assert.equal(writes, 2, 'no full-save fallback or automatic retries');
assert.equal(writable.dirty, true, 'failed save preserves draft');
for (const error of [{ status: 0 }, { status: 403 }, { status: 503, outcomeUnknown: true }, { status: 200, code: 'INVALID_RESPONSE' }]) {
  const state = { ...writable, connectionIssue: '' };
  applyClientError(state, { ...error, message: 'Synthetic failed connection' });
  assert.equal(state.loggedIn, true); assert(state.connectionIssue); assert.match(sessionLabel(state), /上次验证/);
  await assert.rejects(saveDraft(state, () => { throw new Error('must not send'); }), /连接异常/);
}
const expired = { ...writable, connectionIssue: 'offline' };
applyClientError(expired, { status: 401 }); assert.equal(expired.loggedIn, false); assert.equal(expired.connectionIssue, '');
const conflict = { ...writable, connectionIssue: '' };
applyClientError(conflict, { status: 409 }); assert.equal(conflict.loggedIn, true); assert.equal(conflict.connectionIssue, '');

// Worker disconnects and missing replies leave write outcomes unknown, not logged out.
for (const sendMessage of [async () => undefined, async () => { throw new Error('Synthetic disconnect'); }]) {
  globalThis.chrome = { runtime: { sendMessage } };
  await assert.rejects(client('save', 'https://example.invalid/config.html'), error => error.status === 0 && error.code === 'BACKGROUND_UNAVAILABLE' && error.outcomeUnknown === true);
}
delete globalThis.chrome;
console.log(JSON.stringify({ ok: true, identityMoves: true, privateCancel: true, unknownFields: true, noNestedFolders: true, sharedCrud: true, saveGuards: true }));
