import { DEFAULT_CONFIG_URL, normalizeConfigUrl, sitePattern } from './site.js';
import { readSnapshot, writeSnapshot, clearSnapshots, readMenuIndex, writeMenuIndex } from './cache-db.js';
import { clone, deltaPayload } from './model.js';
import { menuTargets, captureItem, appendCapture } from './menu-model.js';

let queue = Promise.resolve();
let epoch = 0;
const serial = task => { const result = queue.catch(() => {}).then(task); queue = result.catch(() => {}); return result; };
const origin = url => new URL(normalizeConfigUrl(url)).origin;
const failure = (message, status, details = {}) => Object.assign(new Error(message), { status, ...details });
const READ_ACTIONS = ['cache.get', 'status.get', 'sync', 'login', 'logout', 'cache.clear'];
const PAGE_ACTIONS = { 'home.html': [...READ_ACTIONS, 'save'], 'start.html': [...READ_ACTIONS, 'save'], 'popup.html': ['cache.get', 'status.get', 'sync'] };
export function trustedClient(sender, action = 'cache.get') {
  return sender.id === chrome.runtime.id && Object.entries(PAGE_ACTIONS).some(([page, actions]) => sender.url === chrome.runtime.getURL(page) && actions.includes(action));
}
async function configured() { return normalizeConfigUrl((await chrome.storage.sync.get({ configUrl: DEFAULT_CONFIG_URL })).configUrl); }
async function guard(configUrl, revision, network = false) {
  if (epoch !== revision || origin(await configured()) !== origin(configUrl)) throw failure('站点或缓存状态已变化，请重新操作', 409);
  if (network && !await chrome.permissions.contains({ origins: [sitePattern(configUrl)] })) throw failure('站点权限已撤销；本机缓存仍可查看，请重新授权后联网', 403, { code: 'SITE_PERMISSION_REQUIRED' });
}
function notify(type, site, extra = {}) {
  chrome.runtime.sendMessage({ channel: 'smarttools-cache-event', type, site, ...extra }).catch(() => {});
}
async function request(configUrl, revision, path, body) {
  await guard(configUrl, revision, true);
  const writing = body !== undefined;
  const uncertain = writing ? '写入结果未确认，请保留草稿并先核对云端，不要直接重复提交。' : '可继续浏览本机缓存，请检查连接。';
  const connectionFailure = (message, status, code) => {
    const error = failure(`${path} · ${message}；${uncertain}`, status, { code, path, outcomeUnknown: writing });
    notify('connection', origin(configUrl), { issue: error.message }); return error;
  };
  let response;
  try {
    response = await fetch(origin(configUrl) + path, { method: writing ? 'POST' : 'GET', credentials: 'include', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json' }, ...(writing ? { body: JSON.stringify(body) } : {}) });
  } catch (error) {
    throw connectionFailure(error.name === 'TimeoutError' || error.name === 'AbortError' ? '请求超时（20 秒），不代表登录已失效' : '网络请求失败，不代表登录已失效', 0, 'NETWORK_UNAVAILABLE');
  }
  await guard(configUrl, revision, true);
  // Authentication is determined by the HTTP status even if an upstream error body is not JSON.
  if (response.status === 401) {
    notify('auth', origin(configUrl), { loggedIn: false });
    throw failure(`${path} · HTTP 401：未登录或会话已过期，请重新登录；本机缓存和草稿保留`, 401, { code: 'AUTH_REQUIRED', path });
  }
  let data;
  try { data = await response.json(); }
  catch { throw connectionFailure(`HTTP ${response.status}：服务端返回了非 JSON 响应，请检查站点或网关`, response.status, 'INVALID_RESPONSE'); }
  if (!response.ok || data.ok === false) {
    const error = failure(`${path} · HTTP ${response.status}：${data.error || '请求失败'}`, response.status, { code: data.code || 'HTTP_ERROR', path, outcomeUnknown: data.outcomeUnknown === true || (writing && response.status >= 500) });
    if (response.status === 403 || response.status >= 500 || error.outcomeUnknown) notify('connection', origin(configUrl), { issue: error.message });
    throw error;
  }
  return data;
}
async function fullData(configUrl, revision, requireAdmin = false) {
  const data = await request(configUrl, revision, '/api/data?format=structured');
  if (!Array.isArray(data.sections) || typeof data.privateFiltered !== 'boolean' || typeof data.dataEtag !== 'string') throw failure('当前服务端尚不支持结构化数据，请升级站点或使用完整后台', 400, { code: 'INVALID_RESPONSE' });
  if (requireAdmin && data.privateFiltered !== false) {
    notify('auth', origin(configUrl), { loggedIn: false }); throw failure('请先登录后再收藏或保存；本机缓存保留', 401);
  }
  return data;
}
async function commit(configUrl, revision, data) {
  await guard(configUrl, revision);
  const snapshot = { schema: 1, site: origin(configUrl), sections: clone(data.sections), privateFiltered: false, dataEtag: data.dataEtag, dataVersion: data.dataVersion, source: data.source, configured: data.configured, hasKV: data.hasKV, savedAt: Date.now() };
  try { await writeSnapshot(snapshot); }
  catch (error) { return { snapshot: { ...snapshot, savedAt: null }, warning: error.message }; }
  notify('changed', snapshot.site, { dataEtag: snapshot.dataEtag });
  let warning;
  try { await rebuildMenus(); } catch { warning = '数据已缓存，但菜单更新失败，请重新打开扩展或刷新收藏位置'; }
  return { snapshot, warning };
}
async function sync(configUrl, revision, force) {
  let cached = null, warning;
  try { cached = await readSnapshot(origin(configUrl)); } catch (error) { warning = error.message; }
  const check = await request(configUrl, revision, '/api/check');
  notify('auth', origin(configUrl), { loggedIn: check.loggedIn === true });
  if (!check.loggedIn) {
    // Public responses are only transient; never replace a complete local copy.
    return { loggedIn: false, snapshot: cached || await fullData(configUrl, revision), warning };
  }
  if (cached && !force) {
    const meta = await request(configUrl, revision, '/api/data-meta');
    if (!meta.loggedIn || meta.privateFiltered !== false) { notify('auth', origin(configUrl), { loggedIn: false }); return { loggedIn: false, snapshot: cached }; }
    if (meta.dataEtag === cached.dataEtag && meta.source === cached.source && check.hasKV === cached.hasKV) return { loggedIn: true, snapshot: cached, warning };
  }
  const data = await fullData(configUrl, revision);
  if (data.privateFiltered) { notify('auth', origin(configUrl), { loggedIn: false }); return { loggedIn: false, snapshot: cached || data, warning }; }
  return { loggedIn: true, ...await commit(configUrl, revision, data) };
}
async function save(configUrl, revision, message, allowInitialize) {
  const latest = await fullData(configUrl, revision, true);
  if (latest.source !== 'kv' && !allowInitialize) throw failure('请在书签管理页确认静态数据初始化到 KV', 403);
  if (!latest.hasKV) throw failure('未绑定 KV：当前只读', 400);
  if (latest.dataEtag !== message.baseEtag || latest.configured !== message.baseSource) throw failure('云端数据或数据源已变化，请保留草稿，刷新并核对后再保存', 409);
  if (!Array.isArray(message.sections)) throw failure('无效草稿', 400);
  if (latest.source !== 'kv' && message.initialize !== true) throw failure('请在管理主页确认静态数据完整初始化到 KV', 409);
  const payload = latest.source === 'kv' ? deltaPayload(latest.sections, message.sections) : { content: 'var sections = ' + JSON.stringify(message.sections, null, 2) + ';\n' };
  const result = await request(configUrl, revision, '/api/save', { ...payload, baseEtag: message.baseEtag, baseSource: message.baseSource });
  // A successful server save must not be reported as a failed write just because local caching failed.
  try {
    return { saved: true, loggedIn: true, ...await commit(configUrl, revision, { ...latest, sections: message.sections, dataEtag: result.dataEtag, dataVersion: result.dataVersion, source: 'kv', configured: 'kv' }) };
  } catch { return { saved: true, warning: '云端已保存，但本机状态已变化；请刷新核对', snapshot: null }; }
}
export async function openHome() {
  const url = chrome.runtime.getURL('home.html');
  const tabs = await chrome.tabs.query({ url });
  if (tabs[0]) { await chrome.tabs.update(tabs[0].id, { active: true }); await chrome.windows.update(tabs[0].windowId, { focused: true }); }
  else await chrome.tabs.create({ url });
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
  await createMenu({ id: 'smarttools-root', title: '收藏到 SmartTools', contexts });
  for (const [g, group] of menuTargets(snapshot).entries()) {
    const parentId = `${revision}-g${g}`;
    await createMenu({ id: parentId, parentId: 'smarttools-root', title: group.title, contexts });
    for (const [i, entry] of group.entries.entries()) {
      const id = `${parentId}-${i}`;
      index.entries[id] = entry.target;
      await createMenu({ id, parentId, title: entry.title, contexts });
    }
  }
  if (!snapshot) await createMenu({ id: 'smarttools-load', parentId: 'smarttools-root', title: '登录／加载收藏位置', contexts });
  await createMenu({ id: 'smarttools-refresh', parentId: 'smarttools-root', title: '刷新收藏位置', contexts });
  await createMenu({ id: 'smarttools-home', parentId: 'smarttools-root', title: '打开书签管理／登录', contexts });
  await writeMenuIndex(index);
}
export function handleMenuClick(info, tab) {
  // Capture the opaque target before queued saves rebuild the menu. Never use array indexes.
  const chosenIndex = readMenuIndex().then(value => ({ value }), error => ({ error }));
  const chosenRevision = epoch;
  return serial(async () => {
    const configUrl = await configured(), revision = epoch;
    if (['smarttools-load', 'smarttools-home'].includes(info.menuItemId)) return openHome();
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
    if (!latest.hasKV) throw failure('未绑定 KV：不能收藏', 400);
    if (latest.source !== 'kv') throw failure('请先在管理主页确认静态数据初始化到 KV', 409);
    const sections = clone(latest.sections);
    if (!appendCapture(sections, target, item, index.site, crypto.randomUUID())) {
      const result = await commit(configUrl, revision, latest);
      return resultStatus(result.warning || '该位置已有相同 URL，已跳过', !!result.warning);
    }
    const result = await request(configUrl, revision, '/api/save', { ...deltaPayload(latest.sections, sections), baseEtag: latest.dataEtag, baseSource: latest.configured });
    let warning;
    try { ({ warning } = await commit(configUrl, revision, { ...latest, sections, dataEtag: result.dataEtag, dataVersion: result.dataVersion })); }
    catch { warning = '本机状态已变化，请刷新核对'; }
    await resultStatus(warning ? `云端已收藏；${warning}` : '已收藏到 SmartTools', !!warning);
  }).catch(error => resultStatus(error.message || '收藏失败，请打开管理主页检查', true));
}
export function dispatch(message, sender = {}) {
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
        await request(configUrl, revision, '/api/login', { username: message.username, password: message.password });
        const value = await sync(configUrl, revision, true);
        if (!value.loggedIn) throw failure('浏览器 Cookie 策略阻止了会话，请检查授权和第三方 Cookie 设置，或使用网站后台', 401);
        return value;
      }
      case 'logout':
        notify('auth', origin(configUrl), { loggedIn: false });
        await request(configUrl, revision, '/api/logout', {});
        return { loggedIn: false, snapshot: await readSnapshot(origin(configUrl)) };
      case 'save': return save(configUrl, revision, message, sender.url === chrome.runtime.getURL('home.html'));
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
  const rebuild = () => serial(rebuildMenus).catch(() => resultStatus('收藏菜单加载失败，请打开管理主页刷新', true));
  chrome.runtime.onInstalled.addListener(rebuild);
  chrome.runtime.onStartup.addListener(rebuild);
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && changes.configUrl) { epoch++; rebuild(); } });
  chrome.permissions.onRemoved.addListener(() => { epoch++; }); // Pages check the affected site; revocation is not logout.
}
