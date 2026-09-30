export const DEFAULT_CONFIG_URL = 'https://qiye.pages.dev';
export function normalizeConfigUrl(raw) {
  const url = new URL(raw || DEFAULT_CONFIG_URL);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入不含凭据的 HTTP(S) 站点地址');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('非本地站点必须使用 HTTPS');
  if (!['/', '/config', '/config.html'].includes(url.pathname)) throw new Error('请输入服务端 origin，不要填写其他页面路径');
  url.pathname = '/';
  url.hash = ''; url.search = '';
  return url.toString();
}
export function sitePattern(configUrl) { return new URL(normalizeConfigUrl(configUrl)).origin + '/*'; }
export async function authorizeSite(raw) {
  const configUrl = normalizeConfigUrl(raw);
  // Called directly from a click handler, before storage/network awaits.
  if (!await chrome.permissions.request({ origins: [sitePattern(configUrl)] })) throw new Error('未获得站点访问权限，地址未保存；原站点设置保持不变');
  const previous = await chrome.storage.sync.get('configUrl');
  await chrome.storage.sync.set({ configUrl });
  return configUrl;
}
