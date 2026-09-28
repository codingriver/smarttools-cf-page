import { mountAccount } from './account-component.js';
import { bindCacheMenu, renderAccountMenu } from './cache-menu.js';
import { icon, mountIcons } from './icons.js';
import { element as el, bookmarkMark, bookmarkLink, cacheLabel } from './view-utils.js';
import { clone, matches, supportedCard, safeUrl, reorder } from './model.js';
import { isFolder, saveDraft } from './draft-actions.js';
import { createEditing } from './library-editing.js';
import { createEditor } from './editor-dialog.js';
import { bindDesktopDrag } from './desktop-drag.js';
import { client, applyClientError, sessionLabel } from './client.js';
import { openExtensionPage } from './navigation.js';
import { DEFAULT_CONFIG_URL, normalizeConfigUrl, authorizeSite, sitePattern } from './site.js';
const $ = id => document.getElementById(id);
mountAccount($('accountHost')); bindCacheMenu($('accountMenu')); mountIcons();
const state = { configUrl: '', sections: [], baseline: [], selected: '', scope: 'group', loggedIn: false, connectionIssue: '', hasKV: false, dirty: false, busy: false, generation: 0, etag: null, source: null, configured: null, savedAt: null };
let connecting = false, folder = null, folderOpener = null, menuOpener = null, selectionPreferences = {};
const identities = new WeakMap(); let identity = 0; const refs = new Map();
const query = () => $('search').value.trim().toLowerCase();
const current = () => state.sections.find(s => s.key === state.selected);
const editable = () => state.loggedIn && !state.connectionIssue && state.hasKV && state.source === 'kv' && !!state.etag && !state.busy;
const editor = createEditor({ editable, changed, beforeOpen: () => { closeMenu(); $('accountMenu').open = false; } });
const hasDraft = () => state.dirty || editor.pending();
const editing = createEditing({ state, dialog: editor.dialog, changed, clearSearch: () => { $('search').value = ''; } });
function status(text, error = false) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
async function run(task) { try { await task(); } catch (error) { status(error.message || '网络不可用；可继续浏览本机缓存', true); } }
function changed() { state.dirty = true; closeMenu(); render(); status('修改已应用到当前页面草稿，尚未保存到云端'); }
function rememberSelection() {
  if (!state.configUrl) return;
  selectionPreferences[new URL(state.configUrl).origin] = state.selected;
  chrome.storage.local.set({ desktopGroupKeys: selectionPreferences }).catch(() => {});
}
function selectGroup(section) {
  state.selected = section.key; $('search').value = ''; closeFolder(); closeMenu(); sidebar(false); rememberSelection(); render();
}
function sidebar(open) { $('sidebar').classList.toggle('open', open); $('openSidebar').setAttribute('aria-expanded', String(open)); }
function refNode(node, ref, drop = false) {
  const object = ref.card || ref.section;
  if (!identities.has(object)) identities.set(object, String(++identity));
  const key = identities.get(object) + (drop ? '-drop' : ''); refs.set(key, ref);
  node.dataset[drop ? 'drop' : 'ref'] = key;
  if (!drop) node.draggable = editable() && !query() && ((ref.group && ref.section.kind === 'card') || (ref.section.kind === 'card' && supportedCard(ref.card, !!ref.parent)));
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
function canEdit(section, card, parent) { return editable() && section.kind === 'card' && (!card || supportedCard(card, !!parent)); }
function groupActions(s) {
  const locked = !canEdit(s); const i = state.sections.indexOf(s);
  return [['编辑分组', () => editing.editGroup(s), locked], ['↑ 上移', () => { if (reorder(state.sections, i, -1)) changed(); }, locked || i === 0], ['↓ 下移', () => { if (reorder(state.sections, i, 1)) changed(); }, locked || i === state.sections.length - 1], ['删除分组', () => editing.deleteGroup(s), locked, true]];
}
function cardActions(section, card, parent) {
  const locked = !canEdit(section, card, parent); const actions = [];
  if (isFolder(card)) actions.push(['打开文件夹', () => openFolder(section, card)]);
  if (safeUrl(card.url, state.configUrl)) actions.push([isFolder(card) ? '打开主链接' : '在新标签页打开', () => openUrl(card.url)]);
  if (card.type === 'desc-clickable' && safeUrl(card.descUrl, state.configUrl)) actions.push(['打开描述链接', () => openUrl(card.descUrl)]);
  if (section.kind !== 'card' || !supportedCard(card, !!parent)) return [...actions, ['在完整后台编辑', () => openUrl(state.configUrl)]];
  const items = parent ? parent.subCards : section.cards; const i = items.indexOf(card);
  actions.push(['编辑', () => editing.editCard(section, card, parent), locked], ['移动到…', () => editing.moveCard(section, card, parent), locked]);
  if (isFolder(card)) actions.push(['新增子书签', () => editing.editCard(section, null, card), locked]);
  actions.push(['↑ 前移', () => { if (reorder(items, i, -1)) changed(); }, locked || i === 0], ['↓ 后移', () => { if (reorder(items, i, 1)) changed(); }, locked || i === items.length - 1], ['删除', () => editing.deleteCard(section, card, parent), locked, true]); return actions;
}
function newActions(s = current()) {
  return [['新增书签', () => editing.editCard(s), !editable() || (s && s.kind !== 'card')], ['新建文件夹', () => editing.editCard(s, null, null, true), !editable() || (s && s.kind !== 'card')], ['新建分组', () => editing.editGroup(), !editable()], ['打开书签管理', () => openExtensionPage('home.html')]];
}
function moreButton(label, actions) {
  const more = el('button', null, 'tile-more'); more.type = 'button'; more.append(icon('more')); more.setAttribute('aria-label', label); more.title = label;
  more.addEventListener('click', event => showMenu(actions(), event, more)); return more;
}
function tile(section, card, parent = null, search = false) {
  const name = card.title || card.content || card.url || '未命名书签';
  const node = el('article', null, 'tile'); node.dataset.tone = String([...name].reduce((n, c) => n + c.codePointAt(0), 0) % 5); refNode(node, { section, card, parent });
  const folderCard = isFolder(card) && !parent;
  const main = folderCard ? btn(null, () => openFolder(section, card, main), false, 'tile-main') : bookmarkLink('', card.url, state.configUrl, 'tile-main');
  main.title = name; main.setAttribute('aria-label', folderCard ? `打开文件夹：${name}` : name);
  let mark;
  if (folderCard) {
    mark = el('span', null, 'tile-mark folder-preview');
    for (const child of (card.subCards || []).slice(0, 4)) mark.append(bookmarkMark(child, state.configUrl, 'mini-mark'));
    if (!card.subCards?.length) mark.append(icon('folder'));
  } else mark = bookmarkMark(card, state.configUrl);
  main.append(mark, el('span', name, 'tile-title')); node.append(main);
  node.append(moreButton('书签操作：' + name, () => cardActions(section, card, parent)));
  if (search) node.append(el('span', [section.label, parent?.title || parent?.content].filter(Boolean).join(' / '), 'tile-path'));
  if (section.kind !== 'card' || !supportedCard(card, !!parent)) node.append(bookmarkLink('特殊类型 · 完整后台', state.configUrl, state.configUrl, 'special-note'));
  node.addEventListener('contextmenu', event => showMenu(cardActions(section, card, parent), event, main));
  node.addEventListener('keydown', event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) showMenu(cardActions(section, card, parent), event, main); });
  return node;
}
function closeFolder(restore = false) { folder = null; $('folderBackdrop').hidden = true; $('folderCards').replaceChildren(); $('folderTools').replaceChildren(); $('folderTitle').textContent = ''; $('folderPath').textContent = ''; delete $('folderCards').dataset.drop; if (restore && folderOpener?.isConnected) folderOpener.focus(); folderOpener = null; }
function openFolder(section, card, opener) {
  folder = { section, card }; folderOpener = opener || document.activeElement; $('accountMenu').open = false; closeMenu(); renderFolder(); $('folderPanel').focus();
}
function renderFolder() {
  if (!folder || !state.sections.includes(folder.section) || !folder.section.cards.includes(folder.card) || folder.section.visible === false) { closeFolder(); return; }
  const { section, card } = folder; $('folderBackdrop').hidden = false;
  $('folderPath').textContent = section.label + (section.private ? ' · Private' : ''); $('folderTitle').textContent = card.title || card.content || '文件夹';
  $('folderTools').replaceChildren();
  if (safeUrl(card.url, state.configUrl)) $('folderTools').append(bookmarkLink('打开主链接 ↗', card.url, state.configUrl));
  $('folderTools').append(btn('新增子书签', () => editing.editCard(section, null, card), !canEdit(section, card)), btn('文件夹操作', event => showMenu(cardActions(section, card), null, $('folderTools').lastElementChild)));
  $('folderCards').replaceChildren(...(card.subCards || []).map(child => tile(section, child, card)));
  refNode($('folderCards'), { section, parent: card }, true);
  if (!card.subCards?.length) $('folderCards').append(el('p', '文件夹为空，可添加或拖入书签', 'empty-state'));
}
function render() {
  closeMenu(); // Retire actions captured before any auth, version or draft transition.
  const visible = state.sections.filter(s => s.visible !== false); if (!visible.some(s => s.key === state.selected)) state.selected = visible[0]?.key || '';
  refs.clear(); const selected = current(), q = query();
  renderAccountMenu($('accountMenu'), state); $('session').textContent = sessionLabel(state); $('cacheInfo').textContent = cacheLabel(state.savedAt);
  $('refresh').disabled = state.busy; $('save').disabled = !editable() || !state.dirty; $('discard').disabled = state.busy; $('addGroup').disabled = !editable(); $('draftBar').hidden = !state.dirty;
  $('groups').replaceChildren();
  for (const section of visible) {
    const row = el('div', null, 'nav-row'); refNode(row, { group: true, section });
    const nav = btn(null, () => selectGroup(section), false, 'nav-group' + (section === selected && !q ? ' selected' : ''));
    nav.setAttribute('aria-label', section.label + (section.private ? ' · Private' : '')); nav.setAttribute('aria-current', section === selected && !q ? 'page' : 'false'); nav.title = section.label;
    nav.append(el('span', [...String(section.label || '组')][0], 'nav-glyph'), el('span', section.label, 'nav-label'));
    if (section.private) { const lock = el('span', null, 'nav-private'); lock.append(icon('lock')); nav.append(lock); }
    const more = moreButton('分组操作：' + section.label, () => groupActions(section)); more.className = 'nav-more'; row.append(nav, more);
    row.addEventListener('contextmenu', event => showMenu(groupActions(section), event, nav)); $('groups').append(row);
  }
  $('groupTitle').textContent = q ? '搜索结果' : selected?.label || '你的书签桌面';
  $('groupInfo').textContent = q ? '所有可见分组' : selected ? (selected.private ? 'Private · ' : '') + `${selected.cards.length} 个书签` : '';
  $('groupMore').hidden = !selected || !!q;
  const grid = $('cards'); grid.replaceChildren(); delete grid.dataset.drop;
  let count = 0;
  if (q) {
    for (const section of visible) for (const card of section.cards) {
      if (matches({ ...card, subCards: [] }, q)) { grid.append(tile(section, card, null, true)); count++; }
      for (const child of card.subCards || []) if (matches(child, q)) { grid.append(tile(section, child, card, true)); count++; }
    }
  } else if (selected) { for (const card of selected.cards) { grid.append(tile(selected, card)); count++; } refNode(grid, { section: selected }, true); }
  if (!count) {
    const empty = el('section', null, 'empty-state'); empty.append(el('h2', q ? '没有找到书签' : selected ? '从一条好链接开始' : '你的书签，从这里开始'), el('p', q ? '试试标题、地址或子书签名称；隐藏分组仅在管理页显示。' : !state.etag ? '连接你的 SmartTools 站点，登录后加载完整书签。' : '在此整理常用书签，也可以到管理页查看隐藏分组。'));
    empty.append(btn(q ? '清除搜索' : editable() ? '新增书签' : state.etag ? '打开书签管理' : '连接站点 / 登录', () => { if (q) { $('search').value = ''; render(); } else if (editable()) editing.editCard(selected); else if (state.etag) return openExtensionPage('home.html'); else { $('accountMenu').open = true; $('siteUrl').focus(); } })); grid.append(empty);
  }
  if (!q && selected?.kind === 'card' && editable()) {
    const add = el('article', null, 'tile tile-add'); const main = btn(null, () => showMenu(newActions(), null, main), false, 'tile-main'); const mark = el('span', null, 'tile-mark'); mark.append(icon('plus')); main.append(mark, el('span', '添加', 'tile-title')); add.append(main); grid.append(add);
  }
  if (state.selected && state.configUrl && selectionPreferences[new URL(state.configUrl).origin] !== state.selected) rememberSelection();
  $('summary').textContent = `${visible.length} 个分组 · ${count} 个${q ? '结果' : '书签'}`; renderFolder();
}
function applySnapshot(data) {
  editor.reset(); closeMenu(); closeFolder(); state.sections = clone(data?.sections || []); state.baseline = clone(state.sections); state.etag = data?.dataEtag || null; state.source = data?.source; state.configured = data?.configured; state.hasKV = data?.hasKV === true; state.savedAt = data?.savedAt; state.dirty = false;
}
async function remote(action, extra = {}) {
  const generation = state.generation;
  try { const value = await client(action, state.configUrl, extra); if (generation !== state.generation) throw new Error('站点或缓存已变化，本次响应已忽略'); return value; }
  catch (error) { if (generation === state.generation) { applyClientError(state, error); render(); } throw error; }
}
async function sync(force = false, action = 'sync', extra = {}) {
  if (state.busy) return; const generation = state.generation; state.busy = true; render();
  try {
    const result = await remote(action, { force, ...extra }); state.loggedIn = result.loggedIn === true; state.connectionIssue = '';
    if (hasDraft()) status(result.snapshot?.dataEtag !== state.etag ? '云端数据已变化；当前草稿保留，请核对后再保存。' : '当前草稿保留。');
    else { applySnapshot(result.snapshot); status(result.warning || (!state.hasKV ? '未绑定 KV · 只读浏览' : state.source !== 'kv' ? '静态数据 · 请在书签管理页确认初始化后再整理' : !state.loggedIn ? '未登录 · 浏览本机缓存／公开数据' : '已同步 · 修改后请保存到云端'), !!result.warning); }
  } finally { if (generation === state.generation) { state.busy = false; render(); } }
}
async function switchSite(configUrl) {
  state.generation++; state.busy = false; state.loggedIn = false; state.connectionIssue = ''; applySnapshot(null); state.configUrl = normalizeConfigUrl(configUrl); state.selected = selectionPreferences[new URL(state.configUrl).origin] || ''; $('siteUrl').value = state.configUrl; $('search').value = '';
  $('website').href = new URL(state.configUrl).origin + '/'; $('backend').href = state.configUrl; closeMenu(); render();
  const snapshot = await remote('cache.get'); if (snapshot) { applySnapshot(snapshot); render(); status('已显示本机缓存，正在检查会话'); } await sync();
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
const drag = bindDesktopDrag({ state, editable, searching: () => !!query(), resolve: node => refs.get(node?.dataset.ref || node?.dataset.drop), changed, report: status, onMoved: to => { state.selected = to.section.key; if (!to.parent) closeFolder(); rememberSelection(); } });
function clock() { const now = new Date(); $('clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); $('date').textContent = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }); $('date').dateTime = now.toISOString(); }
clock(); setInterval(clock, 30000); // Local clock only; no network polling.
$('accountTrigger').addEventListener('click', () => { closeFolder(); closeMenu(); sidebar(false); });
$('search').addEventListener('input', () => { closeMenu(); closeFolder(); render(); });
for (const id of ['openManager', 'sidebarManager']) $(id).addEventListener('click', () => run(() => openExtensionPage('home.html')));
$('openSidebar').addEventListener('click', event => { event.stopPropagation(); sidebar(!$('sidebar').classList.contains('open')); });
$('addGroup').addEventListener('click', () => editing.editGroup());
$('groupMore').addEventListener('click', event => { if (current()) showMenu(groupActions(current()), event, $('groupMore')); });
$('desktop').addEventListener('contextmenu', event => { if (!event.target.closest('.tile')) showMenu(newActions(), event); });
$('closeFolder').addEventListener('click', () => closeFolder(true));
$('folderBackdrop').addEventListener('click', event => { if (event.target === $('folderBackdrop')) closeFolder(true); });
$('save').addEventListener('click', () => run(save));
$('discard').addEventListener('click', () => { if (!state.busy && confirm('放弃当前页面所有未保存修改？')) { editor.reset(); state.sections = clone(state.baseline); state.dirty = false; closeFolder(); render(); status('已放弃草稿；可刷新查看云端最新数据'); } });
$('checkConnection').addEventListener('click', () => run(() => sync(true)));
$('refresh').addEventListener('click', () => run(async () => { if (hasDraft() && !confirm('刷新会丢弃未保存更改，包括冲突草稿。确认？')) return; editor.reset(); state.dirty = false; state.sections = clone(state.baseline); await sync(true); }));
$('siteForm').addEventListener('submit', event => {
  event.preventDefault(); if (state.busy || (hasDraft() && !confirm('切换站点会丢弃未保存草稿，确认？'))) return;
  connecting = true; const promise = authorizeSite($('siteUrl').value);
  run(async () => { try { await switchSite(await promise); } finally { connecting = false; } });
});
$('loginForm').addEventListener('submit', event => { event.preventDefault(); if (state.busy) return; const password = $('password').value; $('password').value = ''; run(() => sync(true, 'login', { username: $('username').value, password })); });
$('logout').addEventListener('click', () => run(async () => {
  if (state.busy || !confirm('退出会丢弃本页草稿并退出同站点网页会话；本机缓存（包括 Private）不会删除。继续？')) return;
  editor.reset(); state.dirty = false; state.loggedIn = false; state.sections = clone(state.baseline); await sync(false, 'logout'); status('已退出 · 本机缓存保留，可离线浏览');
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
