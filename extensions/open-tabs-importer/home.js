import { createEditing } from './library-editing.js';
import { saveDraft } from './draft-actions.js';
import { mountAccount } from './account-component.js';
import { openExtensionPage } from './navigation.js';
import { bookmarkMark, bookmarkLink } from './view-utils.js';
import { icon, mountIcons } from './icons.js';
import { bindCacheMenu, renderAccountMenu } from './cache-menu.js';
import { DEFAULT_CONFIG_URL, normalizeConfigUrl, authorizeSite, sitePattern } from './site.js';
import { client, applyClientError, sessionLabel } from './client.js';
import { clone, supportedCard, reorder, safeUrl, libraryView } from './model.js';
const $ = id => document.getElementById(id);
mountAccount($('accountHost'));
mountIcons();
bindCacheMenu($('accountMenu'));
const state = { configUrl: '', sections: [], baseline: [], selected: '', scope: 'all', layout: 'list', loggedIn: false, connectionIssue: '', hasKV: false, dirty: false, busy: false, etag: null, source: null, configured: null, generation: 0 };
let editCommit = null;
let editorBaseline = '';
const editorValues = () => JSON.stringify([...$('fields').querySelectorAll('input,textarea,select')].map(el => [el.name, el.type === 'checkbox' ? el.checked : el.value]));
function closeEditor() { if (editorValues() !== editorBaseline && !confirm('有尚未应用的输入，放弃并关闭？')) return; $('editor').close(); }
let connecting = false;
function status(message, error = false) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
function hasDraft() { return state.dirty || $('editor').open; }
function editable() { return state.loggedIn && !state.connectionIssue && state.hasKV && !!state.etag && !state.busy; }
function node(tag, text, className) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; }
function button(text, action, disabled = !editable()) { const el = node('button', text); el.type = 'button'; el.disabled = disabled; el.addEventListener('click', () => run(action)); return el; }
function clearData() {
  state.generation++; state.sections = []; state.baseline = []; state.etag = null; state.dirty = false; state.loggedIn = false; state.connectionIssue = ''; state.hasKV = false; state.source = null; state.configured = null; state.selected = ''; state.scope = 'all'; state.savedAt = null;
  $('password').value = ''; $('fields').replaceChildren(); editCommit = null; $('editor').close(); render();
}
function clearCacheView() {
  const loggedIn = state.loggedIn;
  clearData(); state.loggedIn = loggedIn; render();
}
async function remote(action, extra = {}) {
  const generation = state.generation;
  try {
    const value = await client(action, state.configUrl, extra);
    if (generation !== state.generation) throw new Error('站点或缓存状态已变化，本次响应已忽略');
    return value;
  } catch (error) {
    if (generation === state.generation) { applyClientError(state, error); render(); }
    throw error;
  }
}
function applySnapshot(data) {
  $('editor').close(); $('fields').replaceChildren(); editCommit = null;
  state.sections = clone(data?.sections || []); state.baseline = clone(state.sections);
  state.etag = data?.dataEtag; state.source = data?.source; state.configured = data?.configured;
  state.hasKV = data?.hasKV === true; state.savedAt = data?.savedAt; state.dirty = false;
  if (!state.sections.some(s => s.key === state.selected)) { state.selected = ''; if (state.scope === 'group') state.scope = 'all'; }
}
async function cached() {
  const data = await remote('cache.get');
  if (data) { applySnapshot(data); status('已显示本机缓存，正在检查云端会话。'); render(); }
}
async function run(action) {
  try { await action(); } catch (error) { status(error.message || '网络请求失败，请检查连接或在网站后台继续操作', true); }
}
async function busy(action) {
  if (state.busy) return;
  state.busy = true; status('正在处理…'); render();
  try { await action(); } finally { state.busy = false; render(); }
}
function setSite(configUrl) {
  clearData(); state.configUrl = normalizeConfigUrl(configUrl); $('siteUrl').value = state.configUrl;
  $('website').href = new URL(state.configUrl).origin + '/'; $('backend').href = state.configUrl;
}
async function load(force = false, preserveDraft = false) {
  await busy(async () => {
    const result = await remote('sync', { force });
    state.loggedIn = result.loggedIn; state.connectionIssue = '';
    if (preserveDraft && hasDraft()) {
      status(result.snapshot?.dataEtag !== state.etag ? '云端数据已变化；当前草稿保留，保存前请刷新核对。' : '当前草稿保留。');
    } else {
      applySnapshot(result.snapshot);
      status(result.warning || (!state.hasKV ? '未绑定 KV：当前只读。' : !state.loggedIn ? '未登录：本机缓存／公开数据只读。登录后才能云端保存。' : '已加载管理员数据。修改后请点击“保存到云端”。'), !!result.warning);
    }
  });
}
function changed() { state.dirty = true; render(); }
function section() { return state.sections.find(s => s.key === state.selected); }
const scopes = [
  ['all', '全部书签', 'library', '把值得保留的内容，放在触手可及的地方。'],
  ['private', 'Private 书签', 'lock', '私人资料，集中整理。已下载的本机副本仍可离线查看。'],
  ['hidden', '隐藏分组', 'hidden', '暂不在网站显示的分组。隐藏不等于 Private。']
];
function navigate(scope, selected = '') {
  state.scope = scope; state.selected = selected; $('search').value = ''; setSidebar(false); render();
}
function setSidebar(open) {
  $('sidebar').classList.toggle('open', open); $('sidebarBackdrop').hidden = !open;
  $('openSidebar').setAttribute('aria-expanded', String(open));
}
function navItem(label, symbol, count, active, action, className = 'nav-item', isPrivate = false) {
  const el = button(null, action, false); el.className = className + (active ? ' selected' : '');
  el.setAttribute('aria-current', active ? 'page' : 'false');
  el.append(icon(symbol), node('span', label, 'nav-label'));
  if (isPrivate) { const lock = icon('lock'); lock.classList.add('nav-private'); el.append(lock); el.setAttribute('aria-label', label + ' · Private'); }
  el.append(node('span', String(count), 'nav-count')); return el;
}
function actionMenu(label, actions, className = '') {
  const menu = node('details', null, 'item-menu ' + className); const summary = node('summary');
  summary.setAttribute('aria-label', label); summary.title = label; summary.append(icon('more'));
  const list = node('div', null, 'actions');
  for (const [text, action, disabled = !editable(), danger = false] of actions) {
    const item = button(text, () => { menu.open = false; return action(); }, disabled);
    if (danger) item.classList.add('danger'); list.append(item);
  }
  menu.append(summary, list); return menu;
}
function emptyState(query, scope) {
  const el = node('div', null, 'empty-state'); el.append(icon(query ? 'search' : 'bookmark'));
  el.append(node('h2', query ? '没有找到相关书签' : '给好内容留一个位置'));
  el.append(node('p', query ? '试试更短的关键词，或搜索标题、网址、描述和子卡片。' : scope === 'all' ? '从一个分组、一条链接开始。也可以通过浏览器右键，将正在阅读的网页收藏到这里。' : '这个位置还没有内容。你可以添加书签，或返回全部书签继续浏览。'));
  if (query) el.append(button('清除搜索', () => { $('search').value = ''; render(); $('search').focus(); }, false));
  else if (editable()) el.append(button(state.sections.some(s => s.kind === 'card') ? '新建书签' : '创建第一个分组', () => state.sections.some(s => s.kind === 'card') ? editCard(section()) : editGroup(), false));
  else if (scope !== 'all') el.append(button('查看全部书签', () => navigate('all'), false));
  else el.append(button('连接站点 / 登录', () => { $('accountMenu').open = true; $('accountTrigger').focus(); }, false));
  return el;
}
function render() {
  const query = $('search').value.trim();
  const { entries, counts, childCount } = libraryView(state.sections, { scope: state.scope, selected: state.selected, query });
  const current = state.scope === 'group' ? section() : null;
  const scope = scopes.find(([key]) => key === state.scope) || scopes[0];
  const heading = query ? '搜索结果' : current?.label || scope[1];
  $('session').textContent = sessionLabel(state);
  $('cacheInfo').textContent = state.savedAt ? '本机缓存 · 最后同步 ' + new Date(state.savedAt).toLocaleString() : '尚无完整本机缓存';
  renderAccountMenu($('accountMenu'), state);
  $('save').disabled = !editable() || !state.dirty; $('addGroup').disabled = !editable(); $('refresh').disabled = state.busy;
  $('addBookmark').disabled = !editable();
  $('draftBar').hidden = !state.dirty; $('draft').textContent = '有未保存的更改';
  $('syncState').textContent = state.busy ? '正在同步…' : state.dirty ? '尚未保存' : state.connectionIssue ? '连接异常 · 只读' : state.loggedIn ? '已连接云端' : '只读浏览';
  $('siteName').textContent = state.configUrl ? new URL(state.configUrl).hostname : '尚未连接站点';
  $('connectionHint').textContent = state.connectionIssue ? '连接异常 · 草稿保留' : state.loggedIn ? '管理员 · ' + (state.hasKV ? '云端已连接' : '未绑定 KV') : state.savedAt ? '本机缓存 · 只读' : '在右上角登录你的站点';
  $('libraryNav').replaceChildren(...scopes.map(([key, label, symbol]) => navItem(label, symbol, counts[key], !query && state.scope === key, () => navigate(key))));
  $('groups').replaceChildren();
  for (const s of state.sections) $('groups').append(navItem((s.label || s.key) + (s.visible === false ? ' · 隐藏' : ''), 'folder', s.cards.length, !query && state.scope === 'group' && s.key === state.selected, () => navigate('group', s.key), 'group', s.private));
  if (!state.sections.length) $('groups').append(node('p', '你的分组会出现在这里', 'sidebar-empty'));
  $('groupHeader').replaceChildren(node('h1', heading), node('p', query ? `在整个资料库中查找「${query}」` : current ? `${current.private ? 'Private · ' : ''}${current.visible === false ? '网站隐藏 · ' : ''}${current.kind === 'card' ? '按主题整理，让每一条链接都有归处。' : '特殊分组只读展示，请在完整后台编辑。'}` : scope[3], 'page-description'));
  $('breadcrumbCurrent').textContent = heading;
  $('resultInfo').replaceChildren(node('strong', `${entries.length} 个书签`), document.createTextNode(` · ${childCount} 个子卡片${current ? '' : ' · ' + state.sections.length + ' 个分组'}`));
  $('groupActions').replaceChildren();
  if (current && !query) {
    const index = state.sections.indexOf(current);
    $('groupActions').append(actionMenu('分组操作', [
      ['编辑分组', () => editGroup(current)],
      ['↑ 上移', () => { if (reorder(state.sections, index, -1)) changed(); }, !editable() || index === 0],
      ['↓ 下移', () => { if (reorder(state.sections, index, 1)) changed(); }, !editable() || index === state.sections.length - 1],
      ['删除分组', () => deleteGroup(current), !editable(), true]
    ], 'group-menu'));
  }
  $('cards').classList.toggle('list-view', state.layout === 'list');
  for (const [id, value] of [['gridView', 'grid'], ['listView', 'list']]) {
    $(id).classList.toggle('active', state.layout === value); $(id).setAttribute('aria-pressed', String(state.layout === value));
  }
  $('cards').replaceChildren(...entries.map(({ section: s, card }) => renderCard(s, card, false)));
  if (!entries.length) $('cards').append(emptyState(query, state.scope));
}
function renderCard(s, card, child, parent = null, readonly = false) {
  const el = node('article', null, child ? 'subcard' : 'card');
  const name = card.title || card.content || card.url || '未命名书签';
  const heading = node('div', null, 'card-heading'); const mark = bookmarkMark(card, state.configUrl, 'card-icon');
  const title = node('div', null, 'card-title'); const h3 = node('h3'); const link = node('a', name);
  const href = safeUrl(card.url, state.configUrl); if (href) { link.href = href; link.target = '_blank'; link.rel = 'noreferrer noopener'; }
  h3.append(link); title.append(h3);
  const domain = href ? (href.startsWith('mailto:') ? href.slice(7) : new URL(href).hostname.replace(/^www\./, '')) : card.subCards?.length ? '链接集合' : '未设置网址';
  title.append(node('span', domain, 'card-domain')); heading.append(mark, title);
  const supported = !readonly && s.kind === 'card' && supportedCard(card, child);
  if (supported) {
    const items = parent ? parent.subCards : s.cards; const index = items.indexOf(card);
    const actions = [['编辑', () => editCard(s, card, parent)], ['移动', () => moveCard(s, card, parent)]];
    if (!child) actions.push(['＋ 子卡片', () => editCard(s, null, card)]);
    actions.push(['↑', () => { if (reorder(items, index, -1)) changed(); }, !editable() || index === 0], ['↓', () => { if (reorder(items, index, 1)) changed(); }, !editable() || index === items.length - 1], ['删除', () => deleteCard(s, card, parent), !editable(), true]);
    const edit = button(null, () => editCard(s, card, parent)); edit.className = 'icon-button quick-edit'; edit.setAttribute('aria-label', '编辑书签：' + name); edit.title = '编辑书签'; edit.append(icon('edit'));
    heading.append(edit, actionMenu('书签操作：' + name, actions, 'card-actions'));
  }
  el.append(heading);
  el.append(node('p', card.desc || card.note || '', 'description'));
  if (card.note && card.desc) el.append(node('p', card.note, 'card-note'));
  if (card.comment) el.append(node('p', card.comment, 'card-note'));
  if (card.descUrl) { const url = safeUrl(card.descUrl, state.configUrl); if (url) { const a = node('a', '查看相关链接 ↗', 'desc-link'); a.href = url; a.target = '_blank'; a.rel = 'noreferrer'; el.append(a); } }
  const bottom = node('div', null, 'card-bottom'); const badge = node('span', null, 'badge'); badge.append(icon('folder'), document.createTextNode(s.label || s.key)); bottom.append(badge);
  if (s.private) { const privateBadge = node('span', 'Private', 'badge private-badge'); privateBadge.prepend(icon('lock')); bottom.append(privateBadge); }
  if (href) { const open = node('a', null, 'card-open'); open.href = href; open.target = '_blank'; open.rel = 'noreferrer'; open.setAttribute('aria-label', '打开：' + name); open.append(icon('external')); bottom.append(open); }
  el.append(bottom);
  if (!supported) el.append(bookmarkLink('特殊卡片 · 原样保留，在完整后台编辑 ↗', state.configUrl, state.configUrl, 'readonly-note'));
  if (Array.isArray(card.subCards) && card.subCards.length) {
    const details = node('details', null, 'subcards'); details.open = !!$('search').value;
    const summary = node('summary', `${card.subCards.length} 个子卡片`); summary.prepend(icon('layers')); details.append(summary);
    for (const sub of card.subCards) details.append(renderCard(s, sub, true, card, !supported)); el.append(details);
  }
  return el;
}
function dialog(title, fields, commit, drawer = false, context = '') {
  if (!editable()) return;
  $('editTitle').textContent = title; $('fields').replaceChildren();
  const advanced = node('details', null, 'advanced-fields'); advanced.append(node('summary', '更多设置 · 图标与卡片类型'));
  for (const field of fields) {
    const label = node('label', field.label); const input = node(field.options ? 'select' : field.multiline ? 'textarea' : 'input'); input.name = field.name;
    if (field.options) for (const [value, text] of field.options) { const option = node('option', text); option.value = value; input.append(option); }
    else if (!field.multiline) input.type = field.checkbox ? 'checkbox' : 'text';
    if (field.checkbox) input.checked = field.value === true; else input.value = field.value ?? field.options?.[0]?.[0] ?? '';
    if (field.required) input.required = true; label.append(input); (field.advanced ? advanced : $('fields')).append(label);
  }
  if (advanced.children.length > 1) $('fields').append(advanced);
  editCommit = commit; editorBaseline = editorValues(); $('accountMenu').open = false;
  $('editor').classList.toggle('bookmark-editor', drawer); $('editorContext').textContent = context || '先应用到当前页面草稿，再保存到云端。'; $('editor').showModal();
}
const { editGroup, deleteGroup, editCard, moveCard, deleteCard } = createEditing({ state, dialog, changed, clearSearch: () => { $('search').value = ''; } });
async function save() {
  if (!editable() || !state.dirty) return;
  await busy(async () => {
    const result = await saveDraft(state, remote, true);
    if (!result) return;
    state.dirty = false;
    if (result.snapshot) applySnapshot(result.snapshot);
    else { state.connectionIssue = '云端已保存，本机状态待刷新核对'; state.etag = null; }
    status(result.warning ? '云端已保存；' + result.warning : '已保存到云端。网站重新读取后可见；KV 同步可能有短暂延迟。', !!result.warning);
  });
}
$('siteForm').addEventListener('submit', event => {
  event.preventDefault(); if (state.busy) return;
  if (hasDraft() && !confirm('切换站点会丢弃未保存草稿，确认？')) return;
  // Do not defer the permission request beyond the user gesture.
  connecting = true;
  const promise = authorizeSite($('siteUrl').value);
  run(async () => { try { setSite(await promise); await cached(); await load(); } finally { connecting = false; } });
});
$('loginForm').addEventListener('submit', event => {
  event.preventDefault(); if (state.busy) return;
  run(async () => {
    if (!state.configUrl) throw new Error('请先授权并连接站点');
    const password = $('password').value; $('password').value = '';
    await busy(async () => {
      const result = await remote('login', { username: $('username').value, password });
      state.loggedIn = result.loggedIn; state.connectionIssue = '';
      if (!hasDraft()) applySnapshot(result.snapshot);
      status(result.warning || (hasDraft() ? '登录成功；当前草稿保留，请核对云端版本。' : '登录成功；完整书签已缓存到本机。'), !!result.warning);
    });
  });
});
$('logout').addEventListener('click', () => run(async () => {
  if (state.busy || (hasDraft() && !confirm('退出会丢弃未保存草稿，并退出同站点的网页会话。继续？'))) return;
  state.loggedIn = false;
  await busy(async () => {
    try { await remote('logout'); }
    finally { state.loggedIn = false; applySnapshot(await remote('cache.get')); render(); }
    status('已退出登录；本机缓存（包括 Private）保留，只读可查看。');
  });
}));
$('checkConnection').addEventListener('click', () => run(() => load(true, true)));
window.addEventListener('offline', () => { state.connectionIssue = '离线，连接恢复后请检查云端'; render(); status('离线 · 本机缓存和草稿保留，暂时只读', true); });
$('refresh').addEventListener('click', () => run(async () => { if (!hasDraft() || confirm('刷新会丢弃未保存更改，包括冲突草稿。确认？')) await load(true); }));
$('addBookmark').addEventListener('click', () => editCard(state.scope === 'group' ? section() : null));
$('save').addEventListener('click', () => run(save)); $('addGroup').addEventListener('click', () => editGroup()); $('search').addEventListener('input', render);
$('cancelEdit').addEventListener('click', closeEditor);
$('editor').addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
$('editor').addEventListener('click', event => { if (event.target === $('editor')) { const r = $('editor').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeEditor(); } });
$('editor').addEventListener('close', () => { editCommit = null; $('fields').replaceChildren(); });
$('editForm').addEventListener('submit', event => {
  event.preventDefault(); if (!editable() || !editCommit) return;
  run(() => { const values = {}; for (const input of $('fields').querySelectorAll('input,select,textarea')) values[input.name] = input.type === 'checkbox' ? input.checked : input.value;
    if (editCommit(values) === false) return; $('editor').close(); changed(); });
});
window.addEventListener('beforeunload', event => { if (hasDraft()) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.configUrl && !state.busy) run(() => load(false, true));
});
chrome.permissions.onRemoved.addListener(() => run(async () => {
  if (state.configUrl && !await chrome.permissions.contains({ origins: [sitePattern(state.configUrl)] })) {
    state.connectionIssue = '站点权限已撤销，请重新授权'; render(); status('站点权限已撤销；本机缓存保留，只读可查看。', true);
  }
}));
chrome.storage.onChanged.addListener((changes, area) => {
  if (!connecting && area === 'sync' && changes.configUrl && changes.configUrl.newValue !== state.configUrl) {
    if (hasDraft()) { state.loggedIn = false; render(); status('其他页面已切换站点；此页面草稿保留。请放弃修改后重新连接，不能向新站点保存旧草稿。', true); return; }
    run(async () => { setSite(changes.configUrl.newValue || DEFAULT_CONFIG_URL); await cached(); await load(); });
  }
});
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('background.js') || message?.channel !== 'smarttools-cache-event') return;
  if (!state.configUrl) return;
  if (message.site && message.site !== new URL(state.configUrl).origin) return;
  if (message.type === 'auth') { state.loggedIn = message.loggedIn === true; if (!state.loggedIn) state.connectionIssue = ''; render(); }
  if (message.type === 'connection') { state.connectionIssue = message.issue; render(); }
  if (message.type === 'cleared') { clearCacheView(); status('本机缓存和草稿已清除；点击刷新可重新加载。'); }
  if (message.type === 'changed' && !state.busy) run(async () => {
    if (hasDraft()) { status('云端数据已变化；当前草稿保留，保存前请刷新核对。', true); return; }
    applySnapshot(await remote('cache.get')); render();
  });
});
for (const [id, all] of [['clearCache', false], ['clearAllCache', true]]) $(id).addEventListener('click', () => run(async () => {
  if (state.busy || !confirm(`清除${all ? '全部站点' : '当前站点'}的本机缓存（包括 Private）及打开页面的草稿？云端数据不会删除。`)) return;
  await client('cache.clear', state.configUrl, { all });
  clearCacheView(); status('本机缓存和草稿已清除；点击刷新可重新加载。');
}));
run(async () => {
  const stored = await chrome.storage.sync.get({ configUrl: DEFAULT_CONFIG_URL }); setSite(stored.configUrl);
  try { await cached(); } catch (error) { status(error.message, true); }
  await load();
});

$('openSidebar').addEventListener('click', () => setSidebar(true));
$('closeSidebar').addEventListener('click', () => { setSidebar(false); $('openSidebar').focus(); });
$('sidebarBackdrop').addEventListener('click', () => setSidebar(false));
for (const [id, layout] of [['gridView', 'grid'], ['listView', 'list']]) $(id).addEventListener('click', () => { state.layout = layout; render(); });
document.addEventListener('click', event => {
  for (const menu of document.querySelectorAll('.item-menu[open]')) if (!menu.contains(event.target)) menu.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if ($('sidebar').classList.contains('open')) { setSidebar(false); $('openSidebar').focus(); }
    for (const menu of document.querySelectorAll('.item-menu[open]')) { menu.open = false; menu.querySelector('summary').focus(); }
  }
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !$('editor').open && !event.target.closest('input,textarea,select,[contenteditable]')) {
    event.preventDefault(); $('accountMenu').open = false; $('search').focus();
  }
});

$('openStart').addEventListener('click', () => run(() => openExtensionPage('start.html')));
$('discard').addEventListener('click', () => { if (confirm('放弃当前页面全部未保存修改？')) { state.sections = clone(state.baseline); state.dirty = false; $('editor').close(); render(); status('已放弃草稿；可刷新以读取最新已保存版本。'); } });
