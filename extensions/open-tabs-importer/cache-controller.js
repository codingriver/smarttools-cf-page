import { openExtensionPage } from './navigation.js';
import { DEFAULT_CONFIG_URL, normalizeConfigUrl, sitePattern } from './site.js';
import { readSnapshot, writeSnapshot, clearSnapshots, readMenuIndex, writeMenuIndex } from './cache-db.js';
import { clone } from './model.js';
import { validateDocument } from './bookmark-document.js';
import { menuTargets, captureItem, appendCapture } from './menu-model.js';

let queue = Promise.resolve();
let epoch = 0;
const serial = task => { const result = queue.catch(() => {}).then(task); queue = result.catch(() => {}); return result; };
const origin = url => new URL(normalizeConfigUrl(url)).origin;
const failure = (message, status, details = {}) => Object.assign(new Error(message), { status, ...details });
const READ_ACTIONS = ['cache.get', 'status.get', 'sync', 'login', 'logout', 'cache.clear'];
const PAGE_ACTIONS = { 'start.html': [...READ_ACTIONS, 'save'], 'popup.html': ['cache.get', 'status.get', 'sync'] };
export function trustedClient(sender, action = 'cache.get') {
  return sender.id === chrome.runtime.id && Object.entries(PAGE_ACTIONS).some(([page, actions]) => sender.url === chrome.runtime.getURL(page) && actions.includes(action));
}
async function configured() { return normalizeConfigUrl((await chrome.storage.sync.get({ configUrl: DEFAULT_CONFIG_URL })).configUrl); }
async function guard(configUrl, revision, network = false) {
  if (epoch !== revision || origin(await configured()) !== origin(configUrl)) throw failure('站点或缓存状态已变化，请重新操作', 409);
  if (network && !await chrome.permissions.contains({ origins: [sitePattern(configUrl)] })) throw failure('站点尚未授权或权限已撤销；请在右上角账户的“高级设置”中点击“保存地址”并允许访问站点，本机缓存仍可查看', 403, { code: 'SITE_PERMISSION_REQUIRED' });
}
function notify(type, site, extra = {}) {
  chrome.runtime.sendMessage({ channel: 'smarttools-cache-event', type, site, ...extra }).catch(() => {});
}
async function request(configUrl, revision, path, body, method) {
  await guard(configUrl, revision, true);
  const writing = body !== undefined;
  const uncertain = writing ? '写入结果未确认，请保留草稿并先核对云端，不要直接重复提交。' : '可继续浏览本机缓存，请检查连接。';
  const connectionFailure = (message, status, code) => {
    const error = failure(`${path} · ${message}；${uncertain}`, status, { code, path, outcomeUnknown: writing });
    notify('connection', origin(configUrl), { issue: error.message }); return error;
  };
  let response;
  try {
    response = await fetch(origin(configUrl) + path, { method: method || (writing ? 'POST' : 'GET'), credentials: 'include', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json' }, ...(writing ? { body: JSON.stringify(body) } : {}) });
  } catch (error) {
    throw connectionFailure(error.name === 'TimeoutError' || error.name === 'AbortError' ? '请求超时（20 秒），不代表登录已失效' : '网络请求失败，不代表登录已失效', 0, 'NETWORK_UNAVAILABLE');
  }
  try { await guard(configUrl, revision, true); } catch (error) { if (writing && response.ok) { error.outcomeUnknown = true; error.message = '服务端已响应，但本机状态变化；请核对云端后再保存'; } throw error; }
  // Authentication is determined by the HTTP status even if an upstream error body is not JSON.
  if (response.status === 401) {
    notify('auth', origin(configUrl), { loggedIn: false });
    throw failure(`${path} · HTTP 401：未登录或会话已过期，请重新登录；本机缓存和草稿保留`, 401, { code: 'AUTH_REQUIRED', path });
  }
  let data;
  try { data = await response.json(); }
  catch { throw connectionFailure(`HTTP ${response.status}：服务端返回了非 JSON 响应，请检查站点或网关`, response.status, 'INVALID_RESPONSE'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw connectionFailure('无效的 JSON 响应', 502, 'INVALID_RESPONSE');
  if (!response.ok || data.ok === false) {
    const error = failure(`${path} · HTTP ${response.status}：${data.error || '请求失败'}`, response.status, { code: data.code || 'HTTP_ERROR', path, outcomeUnknown: data.outcomeUnknown === true || (writing && response.status >= 500) });
    if (response.status === 403 || response.status >= 500 || error.outcomeUnknown) notify('connection', origin(configUrl), { issue: error.message });
    throw error;
  }
  return data;
}
function confirmed(data) {
  try { validateDocument(data?.document); } catch { throw failure('服务端返回了无效的书签文档，本机确认缓存保留', 502, { code: 'INVALID_RESPONSE' }); }
  if (typeof data.meta?.etag !== 'string' || !data.meta.etag || data.meta.view !== 'admin' || data.meta.source !== 'kv') throw failure('无效的新协议确认响应', 502, { code: 'INVALID_RESPONSE' });
  return data;
}
async function fullData(configUrl, revision) {
  return confirmed(await request(configUrl, revision, '/api/v2/bookmarks'));
}
async function commit(configUrl, revision, data) {
  await guard(configUrl, revision); confirmed(data);
  const snapshot = { schema: 2, site: origin(configUrl), document: data.document, etag: data.meta.etag, savedAt: Date.now() };
  let warning = data.warning, cached = false;
  try { await writeSnapshot(snapshot); cached = true; } catch (error) { warning = '本机缓存未更新：' + error.message; }
  await guard(configUrl, revision);
  if (cached) {
    notify('changed', snapshot.site, { dataEtag: snapshot.etag });
    try { await rebuildMenus(); } catch { warning ||= '菜单更新失败，请刷新收藏位置'; }
  }
  return { snapshot, warning };
}
async function sync(configUrl, revision, force) {
  let cached = null, warning;
  try { cached = await readSnapshot(origin(configUrl)); } catch (error) { warning = error.message; }
  const check = await request(configUrl, revision, '/api/v2/auth/session');
  notify('auth', origin(configUrl), { loggedIn: check.loggedIn === true });
  if (!check.loggedIn) return { loggedIn: false, snapshot: cached, warning };
  if (cached?.schema === 2 && !force) {
    const meta = await request(configUrl, revision, '/api/v2/bookmarks/meta');
    if (meta.schemaVersion !== 2 || typeof meta.etag !== 'string' || !meta.etag || !Number.isSafeInteger(meta.updatedAt) || meta.updatedAt < 0) throw failure('无效的书签版本响应，本机缓存保留', 502, { code: 'INVALID_RESPONSE' });
    if (meta.etag === cached.etag) return { loggedIn: true, usesDefaultPassword: check.usesDefaultPassword === true, snapshot: cached, warning };
    if (meta.updatedAt <= cached.document.updatedAt) return { loggedIn: true, usesDefaultPassword: check.usesDefaultPassword === true, snapshot: cached, warning: '云端副本尚未确认更新，保留本机已确认版本，请稍后核对' };
  }
  const data = await fullData(configUrl, revision);
  if (cached?.schema === 2 && data.meta.etag !== cached.etag && data.document.updatedAt <= cached.document.updatedAt) return { loggedIn: true, usesDefaultPassword: check.usesDefaultPassword === true, snapshot: cached, warning: '云端副本版本较旧或存在并发变化，保留本机确认版本' };
  return { loggedIn: true, usesDefaultPassword: check.usesDefaultPassword === true, ...await commit(configUrl, revision, data) };
}
let lastWrite = 0;
async function putDocument(configUrl, revision, document, baseEtag) {
  validateDocument(document);
  const delay = Math.max(0, 1150 - (Date.now() - lastWrite));
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  lastWrite = Date.now();
  const response = await request(configUrl, revision, '/api/v2/bookmarks', { document, baseEtag }, 'PUT');
  try { return confirmed(response); } catch { throw failure('保存响应无法验证，请保留草稿并先核对云端', 502, { code: 'INVALID_RESPONSE', outcomeUnknown: true }); }
}
async function save(configUrl, revision, message) {
  if (message.initialize) throw failure('扩展不支持初始化，请先完成维护迁移', 403);
  const latest = await fullData(configUrl, revision);
  if (latest.meta.etag !== message.baseEtag) throw failure('云端数据已变化，请保留草稿并核对', 409, { code: 'SAVE_CONFLICT' });
  const result = await putDocument(configUrl, revision, message.document, message.baseEtag);
  try { return { saved: true, loggedIn: true, ...await commit(configUrl, revision, result) }; }
  catch { return { saved: true, warning: '云端已保存，本机状态变化；请刷新核对', snapshot: null }; }
}
export async function openHome() {
  return openExtensionPage('start.html');
}
async function resultStatus(text, error = false) {
  await chrome.storage.session.set({ captureStatus: { text, error, at: Date.now() } });
  await chrome.action.setBadgeText({ text: error ? '!' : '✓' });
  await chrome.action.setBadgeBackgroundColor({ color: error ? '#b45309' : '#32765b' });
  notify('status', null);
}
function createMenu(properties) {
  return new Promise((resolve, reject) => chrome.contextMenus.create(properties, () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()));
}
export async function rebuildMenus() {
  const configUrl = await configured();
  const site = origin(configUrl);
  let snapshot; try { snapshot = await readSnapshot(site); } catch { /* Corrupt cache remains recoverable through refresh/clear. */ }
  const revision = crypto.randomUUID();
  const index = { site, entries: {} };
  const contexts = ['page', 'link', 'action'];
  await chrome.contextMenus.removeAll();
  await createMenu({ id: 'smarttools-root', title: '收藏到栖页', contexts });
  const containerMenus = new Map(); let count = 0, overflow = false;
  for (const group of menuTargets(snapshot)) {
    if (++count > 200) { overflow = true; break; }
    const parentId = `${revision}-g${count}`;
    try {
      await createMenu({ id: parentId, parentId: containerMenus.get(group.parentId) || 'smarttools-root', title: group.title, contexts });
      containerMenus.set(group.id, parentId);
      const id = `${parentId}-save`; index.entries[id] = group.entries[0].target;
      await createMenu({ id, parentId, title: '＋ 收藏到此处', contexts });
    } catch { overflow = true; break; }
  }
  if (overflow) await createMenu({ id: 'smarttools-choose', parentId: 'smarttools-root', title: '更多位置：打开主页手动添加', contexts });
  if (!snapshot?.document) await createMenu({ id: 'smarttools-load', parentId: 'smarttools-root', title: '登录／加载收藏位置', contexts });
  await createMenu({ id: 'smarttools-refresh', parentId: 'smarttools-root', title: '刷新收藏位置', contexts });
  await createMenu({ id: 'smarttools-home', parentId: 'smarttools-root', title: '打开扩展主页／登录', contexts });
  await writeMenuIndex(index);
}
export function handleMenuClick(info, tab) {
  // Capture the opaque target before queued saves rebuild the menu. Never use array indexes.
  const chosenIndex = readMenuIndex().then(value => ({ value }), error => ({ error }));
  const chosenRevision = epoch;
  return serial(async () => {
    const configUrl = await configured(), revision = epoch;
    if (['smarttools-load', 'smarttools-home', 'smarttools-choose'].includes(info.menuItemId)) return openHome();
    if (info.menuItemId === 'smarttools-refresh') {
      const value = await sync(configUrl, revision, true);
      return resultStatus(value.warning || (value.loggedIn ? '收藏位置已刷新' : '请先登录；已缓存收藏位置保留'), !value.loggedIn || !!value.warning);
    }
    const chosen = await chosenIndex;
    if (chosen.error) throw chosen.error;
    const index = chosen.value;
    if (chosenRevision !== epoch) throw failure('站点或缓存状态已变化，请重新操作', 409);
    const target = index?.entries?.[info.menuItemId];
    if (!target || index.site !== origin(configUrl)) throw failure('收藏位置已变化，请重新打开右键菜单', 409);
    const item = captureItem(info, tab);
    const latest = await fullData(configUrl, revision, true);
    const document = clone(latest.document);
    if (!appendCapture(document, target, item, index.site, crypto.randomUUID())) {
      const result = await commit(configUrl, revision, latest);
      return resultStatus(result.warning || '该位置已有相同 URL，已跳过', !!result.warning);
    }
    const result = await putDocument(configUrl, revision, document, latest.meta.etag);
    let warning;
    try { ({ warning } = await commit(configUrl, revision, result)); }
    catch { warning = '本机状态已变化，请刷新核对'; }
    await resultStatus(warning ? `云端已收藏；${warning}` : '已收藏到栖页', !!warning);
  }).catch(error => resultStatus(error.message || '收藏失败，请打开扩展主页检查', true));
}
export function dispatch(message, sender = {}) {
  if (!trustedClient(sender, message.action)) return Promise.reject(failure('不允许的调用来源', 403));
  // Invalidate in-flight responses immediately, then perform the actual delete in queue order.
  if (message.action === 'cache.clear') epoch++;
  const revision = epoch;
  if (['cache.get', 'status.get'].includes(message.action)) return (async () => {
    const configUrl = normalizeConfigUrl(message.configUrl || await configured());
    await guard(configUrl, revision);
    const value = message.action === 'cache.get' ? await readSnapshot(origin(configUrl)) : (await chrome.storage.session.get('captureStatus')).captureStatus || null;
    await guard(configUrl, revision);
    return value;
  })();
  return serial(async () => {
    const configUrl = normalizeConfigUrl(message.configUrl || await configured());
    await guard(configUrl, revision);
    switch (message.action) {
      case 'sync': return sync(configUrl, revision, message.force === true);
      case 'login': {
        await request(configUrl, revision, '/api/v2/auth/login', { username: message.username, password: message.password });
        const value = await sync(configUrl, revision, true);
        if (!value.loggedIn) throw failure('浏览器 Cookie 策略阻止了会话，请检查授权和第三方 Cookie 设置，或使用网站后台', 401);
        return value;
      }
      case 'logout':
        notify('auth', origin(configUrl), { loggedIn: false });
        await request(configUrl, revision, '/api/v2/auth/logout', {});
        return { loggedIn: false, snapshot: await readSnapshot(origin(configUrl)) };
      case 'save': return save(configUrl, revision, message);
      case 'cache.clear':
        await clearSnapshots(message.all === true ? null : origin(configUrl));
        notify('cleared', message.all === true ? null : origin(configUrl));
        await rebuildMenus();
        return null;
      default: throw failure('不支持的扩展操作', 400);
    }
  });
}
export function initializeClient() {
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.channel !== 'smarttools-client') return;
    if (!trustedClient(sender, message.action)) { reply({ ok: false, error: '不允许的调用来源', status: 403, code: 'CLIENT_FORBIDDEN' }); return; }
    dispatch(message, sender).then(value => reply({ ok: true, value }), error => reply({ ok: false, error: error.message || '扩展操作失败', status: error.status, code: error.code, path: error.path, outcomeUnknown: error.outcomeUnknown }));
    return true;
  });
  chrome.contextMenus.onClicked.addListener(handleMenuClick);
  const rebuild = () => serial(rebuildMenus).catch(() => resultStatus('收藏菜单加载失败，请打开扩展主页刷新', true));
  chrome.runtime.onInstalled.addListener(rebuild);
  chrome.runtime.onStartup.addListener(rebuild);
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && changes.configUrl) { epoch++; rebuild(); } });
  chrome.permissions.onRemoved.addListener(() => { epoch++; }); // Pages check the affected site; revocation is not logout.
}
