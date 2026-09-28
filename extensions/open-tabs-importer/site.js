export const DEFAULT_CONFIG_URL = 'https://smarttools-4xj.pages.dev/config.html';
export function normalizeConfigUrl(raw) {
  const url = new URL(raw || DEFAULT_CONFIG_URL);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入不含凭据的 HTTP(S) 站点地址');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('非本地站点必须使用 HTTPS');
  if (url.pathname === '/') url.pathname = '/config.html';
  url.hash = ''; url.search = '';
  return url.toString();
}
export function sitePattern(configUrl) { return new URL(normalizeConfigUrl(configUrl)).origin + '/*'; }
export async function authorizeSite(raw) {
  const configUrl = normalizeConfigUrl(raw);
  // Called directly from a click handler, before storage/network awaits.
  if (!await chrome.permissions.request({ origins: [sitePattern(configUrl)] })) throw new Error('未获得站点访问权限，地址未保存；原站点设置保持不变');
  const previous = await chrome.storage.sync.get('configUrl');
  if (previous.configUrl !== configUrl) await chrome.storage.local.remove('pendingOpenTabsImport');
  await chrome.storage.sync.set({ configUrl });
  await chrome.runtime.sendMessage({ action: 'refresh-import-registration' });
  return configUrl;
}
export async function registerImporter(configUrl) {
  await chrome.scripting.unregisterContentScripts({ ids: ['smarttools-pending'] }).catch(() => {});
  if (!configUrl || !await chrome.permissions.contains({ origins: [sitePattern(configUrl)] })) return;
  const url = new URL(configUrl);
  const paths = ['/config', '/config.html'].includes(url.pathname) ? ['/config', '/config.html'] : [url.pathname];
  await chrome.scripting.registerContentScripts([{
    id: 'smarttools-pending', js: ['pending-import.js'],
    matches: paths.map(path => url.origin + path), runAt: 'document_idle', persistAcrossSessions: true
  }]);
}
