import { emptyDocument, entries, findEntry } from './bookmark-document.js';
import { readBookmarkFile, exportBookmarkJson, prepareImportedDraft, importDescription } from './bookmark-transfer.js';
import { convertSections } from './legacy-convert.js';
import { mountAccount } from './account-component.js';
import { bindCacheMenu, renderAccountMenu } from './cache-menu.js';
import { icon, mountIcons } from './icons.js';
import { element as el, bookmarkMark, bookmarkLink, cacheLabel } from './view-utils.js';
import { clone, matches, supportedCard, safeUrl, reorder } from './model.js';
import { isFolder, saveDraft } from './draft-actions.js';
import { createEditing } from './library-editing.js';
import { createEditor } from './editor-dialog.js';
import { bindDesktopDrag } from './desktop-drag.js';
import { bindSidebarResize } from './sidebar-resize.js';
import { client, applyClientError, sessionLabel } from './client.js';
import { DEFAULT_CONFIG_URL, normalizeConfigUrl, authorizeSite, sitePattern } from './site.js';
const $ = id => document.getElementById(id);
mountAccount($('accountHost')); bindCacheMenu($('accountMenu')); mountIcons();
const state = { configUrl: '', document: emptyDocument(), baseline: emptyDocument(), get sections() { return this.document.roots; }, showHidden: false, selected: '', scope: 'group', loggedIn: false, usesDefaultPassword: false, connectionIssue: '', hasKV: false, dirty: false, busy: false, generation: 0, etag: null, source: null, configured: null, savedAt: null };
let connecting = false, folder = null, folderOpener = null, menuOpener = null, selectionPreferences = {};
const refs = new Map();
const query = () => $('search').value.trim().toLowerCase();
const current = () => state.sections.find(s => s.id === state.selected);
const editable = () => state.loggedIn && !state.connectionIssue && state.hasKV && state.source === 'kv' && !!state.etag && !state.busy;
const editor = createEditor({ editable, changed, beforeOpen: () => { closeMenu(); $('accountMenu').open = false; } });
const hasDraft = () => state.dirty || editor.pending();
const editing = createEditing({ state, dialog: editor.dialog, changed, clearSearch: () => { $('search').value = ''; } });
function status(text, error = false) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
bindSidebarResize({ sidebar: $('sidebar'), separator: $('sidebarResize'), report: status });
async function run(task) { try { await task(); } catch (error) { status(error.message || '网络不可用；可继续浏览本机缓存', true); } }
function changed() { state.dirty = true; closeMenu(); render(); status('修改已应用到当前页面草稿，尚未保存到云端'); }
function rememberSelection() {
  if (!state.configUrl) return;
  selectionPreferences[new URL(state.configUrl).origin] = state.selected;
  chrome.storage.local.set({ desktopGroupKeys: selectionPreferences }).catch(() => {});
}
function selectGroup(section) {
  state.selected = section.id; $('search').value = ''; closeFolder(); closeMenu(); sidebar(false); rememberSelection(); render();
}
function sidebar(open) { $('sidebar').classList.toggle('open', open); $('openSidebar').setAttribute('aria-expanded', String(open)); }
function refNode(node, ref, drop = false) {
  // Folder contents and the desktop are separate drop containers even in the same section.
  const object = ref.card || ref.parent || ref.section;
  const key = (drop ? 'drop:' : 'node:') + object.id; refs.set(key, ref);
  node.dataset[drop ? 'drop' : 'ref'] = key;
  if (!drop) node.draggable = editable() && !query() && ((ref.group && ref.section.type === 'folder') || (ref.section.type === 'folder' && supportedCard(ref.card, !!ref.parent)));
}
function btn(text, action, disabled = false, cls = '') {
  const node = el('button', text, cls); node.type = 'button'; node.disabled = disabled;
  node.addEventListener('click', event => { event.stopPropagation(); run(action); }); return node;
}
function closeMenu(restore = false) { $('contextMenu').hidden = true; $('contextMenu').replaceChildren(); if (restore && menuOpener?.isConnected) menuOpener.focus(); menuOpener = null; }
function showMenu(actions, event, opener) {
  event?.preventDefault(); event?.stopPropagation(); $('accountMenu').open = false; menuOpener = opener || document.activeElement;
  const menu = $('contextMenu'); menu.replaceChildren();
  for (const [label, action, disabled = false, danger = false] of actions) {
    const item = btn(label, () => { closeMenu(); return action(); }, disabled, danger ? 'danger' : ''); item.setAttribute('role', 'menuitem'); menu.append(item);
  }
  menu.hidden = false;
  const rect = opener?.getBoundingClientRect();
  const x = event?.type === 'contextmenu' && event.clientX ? event.clientX : rect?.right || 24;
  const y = event?.type === 'contextmenu' && event.clientY ? event.clientY : rect?.bottom || 80;
  menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + 'px';
  menu.querySelector('button:not(:disabled)')?.focus();
}
function openUrl(value) { const url = safeUrl(value, state.configUrl); if (url) window.open(url, '_blank', 'noopener,noreferrer'); }
function canEdit(section, card, parent) { return editable() && section.type === 'folder' && (!card || supportedCard(card, !!parent)); }
function groupActions(s) {
  const locked = !canEdit(s); const i = state.sections.indexOf(s);
  return [[state.showHidden ? '隐藏隐藏项' : '显示隐藏项（整理模式）', () => { state.showHidden = !state.showHidden; render(); }], ['编辑分组', () => editing.editGroup(s), locked], ['移动到容器…', () => editing.moveCard(s, s), locked], ['↑ 上移', () => { if (reorder(state.sections, i, -1)) changed(); }, locked || i === 0], ['↓ 下移', () => { if (reorder(state.sections, i, 1)) changed(); }, locked || i === state.sections.length - 1], ['删除分组', () => editing.deleteGroup(s), locked, true]];
}
function cardActions(section, card, parent) {
  const locked = !canEdit(section, card, parent); const actions = [];
  if (isFolder(card)) actions.push(['打开文件夹', () => openFolder(section, card)]);
  if (safeUrl(card.url, state.configUrl)) actions.push([isFolder(card) ? '打开主链接' : '在新标签页打开', () => openUrl(card.url)]);
  if (!!card.descUrl && safeUrl(card.descUrl, state.configUrl)) actions.push(['打开描述链接', () => openUrl(card.descUrl)]);
  if (section.type !== 'folder' || !supportedCard(card, !!parent)) return [...actions, ['导出原始节点', () => exportNode(card)], ['删除', () => editing.deleteCard(section, card, parent), !editable(), true]];
  const items = parent ? parent.children : section.children; const i = items.indexOf(card);
  actions.push(['编辑', () => editing.editCard(section, card, parent), locked], ['移动到…', () => editing.moveCard(section, card, parent), locked]);
  if (isFolder(card)) actions.push(['新增子书签', () => editing.editCard(section, null, card), locked], ['新建子文件夹', () => editing.editCard(section, null, card, true), locked]);
  actions.push(['↑ 前移', () => { if (reorder(items, i, -1)) changed(); }, locked || i === 0], ['↓ 后移', () => { if (reorder(items, i, 1)) changed(); }, locked || i === items.length - 1], ['删除', () => editing.deleteCard(section, card, parent), locked, true]); return actions;
}
function newActions(s = current()) {
  return [['新增书签', () => editing.editCard(s), !editable() || (s && s.type !== 'folder')], ['新建文件夹', () => editing.editCard(s, null, null, true), !editable() || (s && s.type !== 'folder')], ['新建分组', () => editing.editGroup(), !editable()], [state.showHidden ? '隐藏整理中的隐藏项' : '显示隐藏项（整理模式）', () => { state.showHidden = !state.showHidden; render(); }]];
}
function moreButton(label, actions) {
  const more = el('button', null, 'tile-more'); more.type = 'button'; more.append(icon('more')); more.setAttribute('aria-label', label); more.title = label;
  more.addEventListener('click', event => showMenu(actions(), event, more)); return more;
}
function tile(section, card, parent = null, search = false) {
  const name = card.title || card.content || card.url || '未命名书签';
  const node = el('article', null, 'tile'); node.dataset.tone = String([...name].reduce((n, c) => n + c.codePointAt(0), 0) % 5); refNode(node, { section, card, parent });
  const folderCard = isFolder(card);
  const main = folderCard ? btn(null, () => openFolder(section, card, main), false, 'tile-main') : bookmarkLink('', card.url, state.configUrl, 'tile-main');
  main.title = name; main.setAttribute('aria-label', folderCard ? `打开文件夹：${name}` : name);
  let mark;
  if (folderCard) {
    mark = el('span', null, 'tile-mark folder-preview');
    for (const child of (card.children || []).slice(0, 4)) mark.append(bookmarkMark(child, state.configUrl, 'mini-mark'));
    if (!card.children?.length) mark.append(icon('folder'));
  } else mark = bookmarkMark(card, state.configUrl);
  main.append(mark, el('span', name, 'tile-title')); node.append(main);
  node.append(moreButton('书签操作：' + name, () => cardActions(section, card, parent)));
  if (search) node.append(el('span', findEntry(state.document, card.id).path.slice(0, -1).map(n => n.title).join(' / '), 'tile-path'));
  if (section.type !== 'folder' || !supportedCard(card, !!parent)) node.append(el('span', '旧版特殊类型 · 只读保留', 'special-note'));
  node.addEventListener('contextmenu', event => showMenu(cardActions(section, card, parent), event, main));
  node.addEventListener('keydown', event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) showMenu(cardActions(section, card, parent), event, main); });
  return node;
}
function closeFolder(restore = false) { folder = null; $('folderBackdrop').hidden = true; $('folderCards').replaceChildren(); $('folderTools').replaceChildren(); $('folderTitle').textContent = ''; $('folderPath').textContent = ''; delete $('folderCards').dataset.drop; if (restore && folderOpener?.isConnected) folderOpener.focus(); folderOpener = null; }
function openFolder(section, card, opener) {
  folder = { section, card }; folderOpener = opener || document.activeElement; $('accountMenu').open = false; closeMenu(); renderFolder(); $('folderPanel').focus();
}
function renderFolder() {
  const entry = folder && findEntry(state.document, folder.card.id);
  if (!entry || entry.node.type !== 'folder' || (!state.showHidden && entry.hidden)) { closeFolder(); return; }
  const section = entry.path[0], card = entry.node; folder.section = section;
  $('folderBackdrop').hidden = false;
  $('folderPath').replaceChildren();
  for (const ancestor of entry.path.slice(0, -1)) $('folderPath').append(btn(ancestor.title + ' / ', () => ancestor === section ? closeFolder() : openFolder(section, ancestor)));
  $('folderTitle').textContent = card.title + (entry.isPrivate ? ' 🔒' : '');
  $('folderTools').replaceChildren();
  $('folderTools').append(btn('返回上级', () => entry.parent === section ? closeFolder() : openFolder(section, entry.parent)));
  if (safeUrl(card.url, state.configUrl)) $('folderTools').append(bookmarkLink('打开主链接 ↗', card.url, state.configUrl));
  $('folderTools').append(btn('新增子书签', () => editing.editCard(section, null, card), !editable()), btn('新建文件夹', () => editing.editCard(section, null, card, true), !editable()), btn('文件夹操作', () => showMenu(cardActions(section, card, entry.parent === section ? null : entry.parent), null, $('folderTools').lastElementChild)));
  const children = card.children.filter(child => state.showHidden || child.visible !== false);
  $('folderCards').replaceChildren(...children.map(child => tile(section, child, card)));
  refNode($('folderCards'), { section, parent: card }, true);
  if (!children.length) $('folderCards').append(el('p', '文件夹为空，可添加或拖入书签', 'empty-state'));
}
function exportNode(node) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(node, null, 2)], { type: 'application/json' }));
  const link = el('a'); link.href = url; link.download = 'qiye-legacy-node.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportBookmarks() {
  if (state.busy || state.source !== 'kv' || !state.savedAt) return;
  if (!confirm('导出当前站点最近确认的完整书签（包含隐藏项和 Private），不包含未保存草稿。JSON 文件未加密，请妥善保管。继续导出？')) return;
  const text = exportBookmarkJson(state.baseline);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = el('a'); link.href = url; link.download = 'qiye-bookmarks-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  status('已发起 JSON 下载：导出的是已确认数据，不含未保存草稿；Private 内容未加密');
}
async function importBookmarks(file) {
  if (!file) return;
  if (!editable()) throw new Error('当前只读，请先登录、检查连接并加载可写版本，再导入 JSON');
  const generation = state.generation, previous = state.document, baseline = state.baseline, etag = state.etag;
  state.busy = true; render();
  try {
    const imported = await readBookmarkFile(file);
    if (generation !== state.generation || previous !== state.document || baseline !== state.baseline || etag !== state.etag ||
        !state.loggedIn || state.connectionIssue || !state.hasKV || state.source !== 'kv') {
      throw new Error('站点、数据或登录状态已变化，本次导入已取消；请核对后重新选择文件');
    }
    const message = `校验通过：${importDescription(imported)}。\n${imported.roots.length ? '' : '注意：这是空文档，保存后会清空全部云端书签。\n'}导入将替换当前页面全部书签${hasDraft() ? '及未保存修改' : ''}，不会合并。Private 和隐藏状态以文件为准，原私有内容可能变为公开。\n仅应用到草稿，之后仍需点击“保存到云端”。继续？`;
    if (!confirm(message)) { status('已取消导入；当前数据和草稿未改变'); return; }
    const draft = prepareImportedDraft(imported, baseline);
    editor.reset(); closeMenu(); closeFolder(); sidebar(false);
    if (document.body.classList.contains('dragging')) drag.cancel();
    state.document = draft.document; state.dirty = draft.dirty; $('search').value = ''; $('accountMenu').open = false;
    status(draft.dirty ? 'JSON 已导入为本页草稿，请核对后点击“保存到云端”；确认缓存尚未改变' : '导入内容与已确认数据相同，无需保存；文件时间未覆盖云端时间');
  } finally { if (generation === state.generation) { state.busy = false; render(); } }
}
function render() {
  closeMenu(); // Retire actions captured before any auth, version or draft transition.
  const visible = state.sections.filter(s => state.showHidden || s.visible !== false); if (!visible.some(s => s.id === state.selected)) state.selected = visible[0]?.id || '';
  refs.clear(); const selected = current(), q = query();
  renderAccountMenu($('accountMenu'), state); $('session').textContent = sessionLabel(state); $('cacheInfo').textContent = cacheLabel(state.savedAt) + (state.document.updatedAt ? ' · 云端更新 ' + new Date(state.document.updatedAt).toLocaleString() : '');
  $('exportBookmarks').disabled = state.busy || state.source !== 'kv' || !state.savedAt; $('importBookmarks').disabled = !editable();
  $('refresh').disabled = state.busy; $('save').disabled = !editable() || !state.dirty; $('discard').disabled = state.busy; $('addGroup').disabled = !editable(); $('draftBar').hidden = !state.dirty;
  $('groups').replaceChildren();
  for (const section of visible) {
    const row = el('div', null, 'nav-row'); refNode(row, { group: true, section });
    const nav = btn(null, () => selectGroup(section), false, 'nav-group' + (section === selected && !q ? ' selected' : ''));
    nav.setAttribute('aria-label', section.title + (section.isPrivate ? ' · Private' : '')); nav.setAttribute('aria-current', section === selected && !q ? 'page' : 'false'); nav.title = section.title;
    nav.append(el('span', [...String(section.title || '组')][0], 'nav-glyph'), el('span', section.title, 'nav-label'));
    if (section.isPrivate) { const lock = el('span', null, 'nav-private'); lock.append(icon('lock')); nav.append(lock); }
    const more = moreButton('分组操作：' + section.title, () => groupActions(section)); more.className = 'nav-more'; row.append(nav, more);
    row.addEventListener('contextmenu', event => showMenu(groupActions(section), event, nav)); $('groups').append(row);
  }
  $('groupTitle').textContent = q ? '搜索结果' : selected?.title || '你的书签桌面';
  $('groupInfo').textContent = q ? '所有可见分组' : selected ? (selected.isPrivate ? 'Private · ' : '') + `${selected.children.length} 个书签` : '';
  $('groupMore').hidden = !selected || !!q;
  const grid = $('cards'); grid.replaceChildren(); delete grid.dataset.drop;
  let count = 0;
  if (q) {
    for (const entry of entries(state.document)) {
      if (!entry.parent || (!state.showHidden && entry.hidden)) continue;
      const card = entry.node, section = entry.path[0];
      if (matches({ ...card, children: [] }, q)) { grid.append(tile(section, card, entry.parent === section ? null : entry.parent, true)); count++; }
    }
  } else if (selected) { for (const card of selected.children.filter(n => state.showHidden || n.visible !== false)) { grid.append(tile(selected, card)); count++; } refNode(grid, { section: selected }, true); }
  if (!count) {
    const empty = el('section', null, 'empty-state'); empty.append(el('h2', q ? '没有找到书签' : selected ? '从一条好链接开始' : '你的书签，从这里开始'), el('p', q ? '试试标题、地址或子书签名称；可在分类菜单开启隐藏项整理。' : !state.etag ? '连接你的书签站点，登录后加载完整书签。' : '在此整理常用书签，可从分类菜单开启隐藏项整理。'));
    empty.append(btn(q ? '清除搜索' : editable() ? '新增书签' : state.etag ? '整理隐藏项' : '连接站点 / 登录', () => { if (q) { $('search').value = ''; render(); } else if (editable()) editing.editCard(selected); else if (state.etag) { state.showHidden = true; render(); } else { $('accountMenu').open = true; $('siteSettings').open = true; $('siteUrl').focus(); } })); grid.append(empty);
  }
  if (!selected && !state.showHidden && state.sections.some(s => s.visible === false)) grid.append(btn('显示隐藏项（整理模式）', () => { state.showHidden = true; render(); }));
  if (!q && selected?.type === 'folder' && editable()) {
    const add = el('article', null, 'tile tile-add'); const main = btn(null, () => showMenu(newActions(), null, main), false, 'tile-main'); const mark = el('span', null, 'tile-mark'); mark.append(icon('plus')); main.append(mark, el('span', '添加', 'tile-title')); add.append(main); grid.append(add);
  }
  if (state.selected && state.configUrl && selectionPreferences[new URL(state.configUrl).origin] !== state.selected) rememberSelection();
  $('summary').textContent = `${visible.length} 个分组 · ${count} 个${q ? '结果' : '书签'}`; renderFolder();
}
function applySnapshot(data) {
  editor.reset(); closeMenu(); closeFolder();
  state.document = clone(data?.document || (data?.legacy ? convertSections(data.sections) : emptyDocument()));
  state.baseline = clone(state.document); state.etag = data?.schema === 2 ? data.etag : null;
  state.source = data?.schema === 2 ? 'kv' : data?.legacy ? 'legacy-cache' : null;
  state.hasKV = data?.schema === 2; state.savedAt = data?.savedAt; state.dirty = false;
}
async function remote(action, extra = {}) {
  const generation = state.generation;
  try { const value = await client(action, state.configUrl, extra); if (generation !== state.generation) throw new Error('站点或缓存已变化，本次响应已忽略'); return value; }
  catch (error) { if (generation === state.generation) { applyClientError(state, error); render(); } throw error; }
}
async function sync(force = false, action = 'sync', extra = {}) {
  if (state.busy) return; const generation = state.generation; state.busy = true; render();
  try {
    const result = await remote(action, { force, ...extra }); state.loggedIn = result.loggedIn === true; state.usesDefaultPassword = result.usesDefaultPassword === true; state.connectionIssue = '';
    if (hasDraft()) status(result.snapshot?.etag !== state.etag ? '云端数据已变化；当前草稿保留，请核对后再保存。' : '当前草稿保留。');
    else { applySnapshot(result.snapshot); status(result.warning || (state.source === 'legacy-cache' ? '旧版本机缓存只读 · 请先完成服务端维护迁移' : !state.etag ? '尚未加载新书签库 · 请登录并检查服务端迁移状态' : !state.loggedIn ? '未登录 · 本机缓存只读' : '已同步 · 修改后请保存到云端'), !!result.warning); }
  } finally { if (generation === state.generation) { state.busy = false; render(); } }
}
async function switchSite(configUrl) {
  state.generation++; state.busy = false; state.loggedIn = false; state.usesDefaultPassword = false; state.connectionIssue = ''; applySnapshot(null); state.configUrl = normalizeConfigUrl(configUrl); state.selected = selectionPreferences[new URL(state.configUrl).origin] || ''; $('siteUrl').value = state.configUrl; $('search').value = '';
  $('website').href = new URL(state.configUrl).origin + '/'; $('backend').href = new URL('/account.html', state.configUrl).href; closeMenu(); render();
  const snapshot = await remote('cache.get'); if (snapshot) { applySnapshot(snapshot); render(); status(snapshot.legacy ? '旧版本机缓存只读；联网完成服务器迁移后可编辑' : '已显示本机缓存，正在检查会话'); } await sync();
}
async function save() {
  if (!editable() || !state.dirty) return; const generation = state.generation; state.busy = true; render();
  try {
    const result = await saveDraft(state, remote);
    if (result?.snapshot) applySnapshot(result.snapshot);
    else if (result?.saved) { state.dirty = false; state.etag = null; state.connectionIssue = '云端已保存，本机状态待刷新核对'; }
    status(result.warning ? '云端已保存；' + result.warning : '已保存到云端。KV 同步可能有短暂延迟。', !!result.warning);
  } finally { if (generation === state.generation) { state.busy = false; render(); } }
}
const drag = bindDesktopDrag({ state, editable, searching: () => !!query(), resolve: node => refs.get(node?.dataset.ref || node?.dataset.drop), changed, report: status, onMoved: to => { state.selected = to.section.id; if (!to.parent) closeFolder(); rememberSelection(); } });
function clock() { const now = new Date(); $('clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); $('date').textContent = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }); $('date').dateTime = now.toISOString(); }
clock(); setInterval(clock, 30000); // Local clock only; no network polling.
$('exportBookmarks').addEventListener('click', () => run(exportBookmarks));
$('importBookmarks').addEventListener('click', () => { if (editable()) { $('bookmarkFile').value = ''; $('bookmarkFile').click(); } });
$('bookmarkFile').addEventListener('change', () => { const file = $('bookmarkFile').files[0]; $('bookmarkFile').value = ''; run(() => importBookmarks(file)); });
$('accountTrigger').addEventListener('click', () => { closeFolder(); closeMenu(); sidebar(false); });
$('search').addEventListener('input', () => { closeMenu(); closeFolder(); render(); });
$('openSidebar').addEventListener('click', event => { event.stopPropagation(); sidebar(!$('sidebar').classList.contains('open')); });
$('addGroup').addEventListener('click', () => editing.editGroup());
$('groupMore').addEventListener('click', event => { if (current()) showMenu(groupActions(current()), event, $('groupMore')); });
$('desktop').addEventListener('contextmenu', event => { if (!event.target.closest('.tile')) showMenu(newActions(), event); });
$('closeFolder').addEventListener('click', () => closeFolder(true));
$('folderBackdrop').addEventListener('click', event => { if (event.target === $('folderBackdrop')) closeFolder(true); });
$('save').addEventListener('click', () => run(save));
$('discard').addEventListener('click', () => { if (!state.busy && confirm('放弃当前页面所有未保存修改？')) { editor.reset(); state.document = clone(state.baseline); state.dirty = false; closeFolder(); render(); status('已放弃草稿；可刷新查看云端最新数据'); } });
$('checkConnection').addEventListener('click', () => run(() => sync(true)));
$('refresh').addEventListener('click', () => run(async () => { if (hasDraft() && !confirm('刷新会丢弃未保存更改，包括冲突草稿。确认？')) return; editor.reset(); state.dirty = false; state.document = clone(state.baseline); await sync(true); }));
$('siteForm').addEventListener('submit', event => {
  event.preventDefault(); if (state.busy || (hasDraft() && !confirm('切换站点会丢弃未保存草稿，确认？'))) return;
  connecting = true; const promise = authorizeSite($('siteUrl').value);
  run(async () => { try { await switchSite(await promise); } finally { connecting = false; } });
});
$('loginForm').addEventListener('submit', event => { event.preventDefault(); if (state.busy) return; const password = $('password').value; $('password').value = ''; run(() => sync(true, 'login', { username: $('username').value, password })); });
$('logout').addEventListener('click', () => run(async () => {
  if (state.busy || !confirm('退出会丢弃本页草稿并退出同站点网页会话；本机缓存（包括 Private）不会删除。继续？')) return;
  editor.reset(); state.dirty = false; state.loggedIn = false; state.usesDefaultPassword = false; state.document = clone(state.baseline); await sync(false, 'logout'); status('已退出 · 本机缓存保留，可离线浏览');
}));
for (const [id, all] of [['clearCache', false], ['clearAllCache', true]]) $(id).addEventListener('click', () => run(async () => {
  if (state.busy || !confirm(`清除${all ? '全部站点' : '当前站点'}本机缓存（含 Private）和打开页面的草稿？云端不会删除。`)) return;
  await client('cache.clear', state.configUrl, { all }); state.generation++; applySnapshot(null); render(); status('本机缓存已清除');
}));
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('background.js') || message?.channel !== 'smarttools-cache-event') return;
  if (!state.configUrl || (message.site && message.site !== new URL(state.configUrl).origin)) return;
  if (message.type === 'auth') { state.loggedIn = message.loggedIn === true; if (!state.loggedIn) state.connectionIssue = ''; render(); }
  if (message.type === 'connection') { state.connectionIssue = message.issue; render(); }
  if (message.type === 'cleared') { state.generation++; state.busy = false; drag.cancel(); applySnapshot(null); render(); status('本机缓存和草稿已清除'); }
  if (message.type === 'changed' && !state.busy) run(async () => {
    if (hasDraft()) { status('云端数据已变化；当前草稿保留，保存前请刷新核对。', true); return; }
    const snapshot = await remote('cache.get'); if (hasDraft()) { status('云端数据已变化；当前草稿保留。', true); return; } applySnapshot(snapshot); render(); status('已更新到最新已保存数据');
  });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (!connecting && area === 'sync' && changes.configUrl && changes.configUrl.newValue !== state.configUrl) {
    if (hasDraft()) { state.loggedIn = false; render(); status('其他页面已切换站点；此页草稿保留。请放弃草稿后重新连接，不能向新站点保存旧草稿。', true); return; }
    run(() => switchSite(changes.configUrl.newValue || DEFAULT_CONFIG_URL));
  }
});
chrome.permissions.onRemoved.addListener(() => run(async () => { if (state.configUrl && !await chrome.permissions.contains({ origins: [sitePattern(state.configUrl)] })) { state.connectionIssue = '站点权限已撤销，请在账户的“高级设置”中重新授权'; drag.cancel(); render(); status('站点权限已撤销 · 本机缓存和已有草稿保留，当前只读', true); } }));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.configUrl) run(() => sync()); });
window.addEventListener('offline', () => { state.connectionIssue = '离线，连接恢复后请检查云端'; render(); status('离线 · 本机缓存和已有草稿保留，当前只读', true); });
window.addEventListener('beforeunload', event => { if (hasDraft()) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('click', event => {
  if (!event.target.closest('#contextMenu,.tile-more,.nav-more,#groupMore')) closeMenu();
  if (!event.target.closest('#sidebar,#openSidebar')) sidebar(false);
});
document.addEventListener('keydown', event => {
  if ($('editor').open) return;
  if (folder && event.key === 'Tab' && $('contextMenu').hidden) {
    const controls = [...$('folderPanel').querySelectorAll('button:not(:disabled),a[href]')].filter(node => node.getClientRects().length);
    const index = controls.indexOf(document.activeElement);
    if (index < 0 || (!event.shiftKey && index === controls.length - 1) || (event.shiftKey && index === 0)) {
      event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
    }
  }
  if (event.key === 'Escape') { if (!$('contextMenu').hidden) closeMenu(true); else if (folder) closeFolder(true); else sidebar(false); }
  if (!$('contextMenu').hidden && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); const items = [...$('contextMenu').querySelectorAll('button:not(:disabled)')]; const i = items.indexOf(document.activeElement); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); closeFolder(); closeMenu(); $('accountMenu').open = false; $('search').focus(); }
});
run(async () => { const stored = await chrome.storage.sync.get({ configUrl: DEFAULT_CONFIG_URL }); selectionPreferences = (await chrome.storage.local.get('desktopGroupKeys')).desktopGroupKeys || {}; await switchSite(stored.configUrl); });
