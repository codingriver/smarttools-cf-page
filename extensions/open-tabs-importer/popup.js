const DEFAULT_CONFIG_URL = 'https://smarttools-4xj.pages.dev/config.html';

function requireElement(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required popup element: #${id}`);
  return el;
}

const els = {
  configUrl: requireElement('configUrl'),
  saveUrl: requireElement('saveUrl'),
  openBackend: requireElement('openBackend'),
  openHome: requireElement('openHome'),
  importActive: requireElement('importActive'),
  importCurrent: requireElement('importCurrent'),
  importAll: requireElement('importAll'),
  copyCurrent: requireElement('copyCurrent'),
  copyAll: requireElement('copyAll'),
  copyTextUrlsOnly: requireElement('copyTextUrlsOnly'),
  copyTextCurrent: requireElement('copyTextCurrent'),
  copyTextAll: requireElement('copyTextAll'),
  exportCurrentFile: requireElement('exportCurrentFile'),
  exportAllFile: requireElement('exportAllFile'),
  exportJsonCurrent: requireElement('exportJsonCurrent'),
  exportJsonAll: requireElement('exportJsonAll'),
  status: requireElement('status')
};

function setStatus(message, kind = '') {
  els.status.textContent = message;
  els.status.className = 'status ' + kind;
}

function normalizeConfigUrl(raw) {
  const url = new URL(raw || DEFAULT_CONFIG_URL);
  if (!url.pathname || url.pathname === '/') url.pathname = '/config.html';
  return url.toString();
}

async function getConfigUrl() {
  const data = await chrome.storage.sync.get({ configUrl: DEFAULT_CONFIG_URL });
  return normalizeConfigUrl(data.configUrl);
}

async function saveConfigUrl() {
  try {
    const configUrl = normalizeConfigUrl(els.configUrl.value);
    await chrome.storage.sync.set({ configUrl });
    els.configUrl.value = configUrl;
    setStatus('后台地址已保存', 'ok');
  } catch (e) {
    setStatus('地址格式不正确', 'err');
  }
}

async function openBackend() {
  let configUrl;
  try {
    configUrl = normalizeConfigUrl(els.configUrl.value || await getConfigUrl());
  } catch (e) {
    setStatus('请先填写正确的后台地址', 'err');
    return;
  }
  await chrome.storage.sync.set({ configUrl });
  els.configUrl.value = configUrl;
  await chrome.tabs.create({ url: configUrl, active: true });
  setStatus('已打开 SmartTools 后台', 'ok');
}

function getBackendHomeUrl(configUrl) {
  const url = new URL(configUrl);
  return `${url.origin}/`;
}

async function openHome() {
  let configUrl;
  try {
    configUrl = normalizeConfigUrl(els.configUrl.value || await getConfigUrl());
  } catch (e) {
    setStatus('请先填写正确的后台地址', 'err');
    return;
  }
  await chrome.storage.sync.set({ configUrl });
  els.configUrl.value = configUrl;
  await chrome.tabs.create({ url: getBackendHomeUrl(configUrl), active: true });
  setStatus('已打开 SmartTools 主页', 'ok');
}

function sameConfigPage(tabUrl, configUrl) {
  try {
    const a = new URL(tabUrl);
    const b = new URL(configUrl);
    return a.origin === b.origin && sameConfigPath(a.pathname, b.pathname);
  } catch (e) {
    return false;
  }
}

function normalizePagePath(pathname) {
  const path = String(pathname || '/').replace(/\/+$/, '') || '/';
  return path.toLowerCase();
}

function sameConfigPath(tabPathname, configPathname) {
  const tabPath = normalizePagePath(tabPathname);
  const configPath = normalizePagePath(configPathname);
  if (tabPath === configPath) return true;
  const configAliases = new Set(['/config', '/config.html']);
  return configAliases.has(tabPath) && configAliases.has(configPath);
}

function isImportableUrl(url) {
  return /^https?:\/\//i.test(url || '');
}

function sanitizeFaviconUrl(url) {
  const raw = String(url || '').trim();
  if (!raw || /^data:image\//i.test(raw)) return '';
  return raw;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toPayloadTab(tab) {
  return {
    title: tab.title || tab.url || '',
    url: tab.url || '',
    favIconUrl: sanitizeFaviconUrl(tab.favIconUrl)
  };
}

async function collectTabs(scope, configUrl) {
  let query;
  if (scope === 'all') {
    query = {};
  } else if (scope === 'active') {
    query = { active: true, currentWindow: true };
  } else {
    query = { currentWindow: true };
  }
  const tabs = await chrome.tabs.query(query);
  return tabs
    .filter(tab => isImportableUrl(tab.url) && !sameConfigPage(tab.url, configUrl))
    .map(toPayloadTab);
}

function importStatusMessage(scope, tabsLength, pending) {
  if (scope === 'active') {
    return pending
      ? '已打开 SmartTools 后台，并准备收藏当前页'
      : '已发送当前页到 SmartTools 后台';
  }
  return pending
    ? `已打开 SmartTools 后台，并准备导入 ${tabsLength} 个标签`
    : `已发送 ${tabsLength} 个标签到 SmartTools 后台`;
}

async function findConfigTab(configUrl) {
  const tabs = await chrome.tabs.query({});
  return tabs.find(tab => sameConfigPage(tab.url, configUrl)) || null;
}

async function injectTabs(tabId, payload) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: data => {
      window.postMessage(data, window.location.origin);
    },
    args: [payload]
  });
}

async function deliverTabsToConfigTab(tabId, payload) {
  for (let i = 0; i < 6; i++) {
    try {
      await injectTabs(tabId, payload);
      return true;
    } catch (e) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  return false;
}

async function importTabs(scope) {
  let configUrl;
  try {
    configUrl = normalizeConfigUrl(els.configUrl.value || await getConfigUrl());
  } catch (e) {
    setStatus('请先填写正确的后台地址', 'err');
    return;
  }
  await chrome.storage.sync.set({ configUrl });
  els.configUrl.value = configUrl;

  const tabs = await collectTabs(scope, configUrl);
  if (!tabs.length) {
    setStatus('没有可导入的普通网页标签', 'err');
    return;
  }

  const configTab = await findConfigTab(configUrl);
  if (!configTab) {
    await chrome.storage.local.set({
      pendingOpenTabsImport: {
        configUrl,
        scope,
        sentAt: new Date().toISOString(),
        tabs
      }
    });
    await chrome.tabs.create({ url: configUrl, active: true });
    setStatus(importStatusMessage(scope, tabs.length, true), 'ok');
    return;
  }

  const delivered = await deliverTabsToConfigTab(configTab.id, {
    source: 'smarttools-open-tabs-extension',
    scope,
    sentAt: new Date().toISOString(),
    tabs
  });
  await chrome.tabs.update(configTab.id, { active: true });
  await chrome.windows.update(configTab.windowId, { focused: true });
  if (!delivered) {
    setStatus('后台页面还没准备好，请稍后再试', 'err');
    return;
  }
  setStatus(importStatusMessage(scope, tabs.length, false), 'ok');
}

// Copy to clipboard as JSON
async function copyTabsToClipboard(scope) {
  let configUrl;
  try {
    configUrl = normalizeConfigUrl(els.configUrl.value || await getConfigUrl());
  } catch (e) {
    setStatus('请先填写正确的后台地址', 'err');
    return;
  }
  await chrome.storage.sync.set({ configUrl });
  els.configUrl.value = configUrl;

  const tabs = await collectTabs(scope, configUrl);
  if (!tabs.length) {
    setStatus('没有可复制的普通网页标签', 'err');
    return;
  }

  const json = JSON.stringify(tabs, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    setStatus(`已复制 ${tabs.length} 个标签到剪切板 (JSON)`, 'ok');
  } catch (e) {
    setStatus('复制失败，请检查浏览器权限', 'err');
  }
}

function tabsToText(tabs, urlsOnly) {
  return tabs.map(tab => {
    if (urlsOnly) return tab.url || '';
    const title = tab.title || tab.url || '';
    const url = tab.url || '';
    return `${title}\t${url}`;
  }).join('\n');
}

async function copyTabsAsText(scope) {
  let configUrl;
  try {
    configUrl = normalizeConfigUrl(els.configUrl.value || await getConfigUrl());
  } catch (e) {
    setStatus('请先填写正确的后台地址', 'err');
    return;
  }
  await chrome.storage.sync.set({ configUrl });
  els.configUrl.value = configUrl;

  const tabs = await collectTabs(scope, configUrl);
  if (!tabs.length) {
    setStatus('没有可复制的普通网页标签', 'err');
    return;
  }

  const urlsOnly = els.copyTextUrlsOnly.checked;
  const text = tabsToText(tabs, urlsOnly);
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`已复制 ${tabs.length} 个标签到剪切板 (${urlsOnly ? '仅 URL' : '文本'})`, 'ok');
  } catch (e) {
    setStatus('复制失败，请检查浏览器权限', 'err');
  }
}

// Export to HTML file (Chrome-compatible bookmark format)
async function exportTabsToFile(scope) {
  let configUrl;
  try {
    configUrl = normalizeConfigUrl(els.configUrl.value || await getConfigUrl());
  } catch (e) {
    setStatus('请先填写正确的后台地址', 'err');
    return;
  }
  await chrome.storage.sync.set({ configUrl });
  els.configUrl.value = configUrl;

  const tabs = await collectTabs(scope, configUrl);
  if (!tabs.length) {
    setStatus('没有可导出的普通网页标签', 'err');
    return;
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `smarttools-tabs-${scope === 'current' ? 'current' : 'all'}-${timestamp}.html`;

  const html = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- SmartTools Tabs Export -->',
    '<TITLE>SmartTools Tabs</TITLE>',
    '<H1>SmartTools Tabs</H1>',
    '<DL><p>',
    ...tabs.map(tab => {
      const escapedTitle = escapeHtml(tab.title || tab.url || '');
      const escapedUrl = escapeHtml(tab.url || '');
      return `    <DT><A HREF="${escapedUrl}">${escapedTitle}</A>`;
    }),
    '</p></DL>'
  ].join('\n');

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setStatus(`已导出 ${tabs.length} 个标签到文件 (HTML)`, 'ok');
  } catch (e) {
    setStatus('导出失败，请检查浏览器权限', 'err');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function exportTabsToJsonFile(scope) {
  let configUrl;
  try {
    configUrl = normalizeConfigUrl(els.configUrl.value || await getConfigUrl());
  } catch (e) {
    setStatus('请先填写正确的后台地址', 'err');
    return;
  }
  await chrome.storage.sync.set({ configUrl });
  els.configUrl.value = configUrl;

  const tabs = await collectTabs(scope, configUrl);
  if (!tabs.length) {
    setStatus('没有可导出的普通网页标签', 'err');
    return;
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `smarttools-tabs-${scope === 'current' ? 'current' : 'all'}-${timestamp}.json`;
  const json = JSON.stringify(tabs, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setStatus(`已导出 ${tabs.length} 个标签到文件 (JSON)`, 'ok');
  } catch (e) {
    setStatus('导出失败，请检查浏览器权限', 'err');
  } finally {
    URL.revokeObjectURL(url);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  els.configUrl.value = await getConfigUrl();
  els.saveUrl.addEventListener('click', saveConfigUrl);
  els.openBackend.addEventListener('click', openBackend);
  els.openHome.addEventListener('click', openHome);
  els.importActive.addEventListener('click', () => importTabs('active'));
  els.importCurrent.addEventListener('click', () => importTabs('current'));
  els.importAll.addEventListener('click', () => importTabs('all'));
  els.copyCurrent.addEventListener('click', () => copyTabsToClipboard('current'));
  els.copyAll.addEventListener('click', () => copyTabsToClipboard('all'));
  els.copyTextCurrent.addEventListener('click', () => copyTabsAsText('current'));
  els.copyTextAll.addEventListener('click', () => copyTabsAsText('all'));
  els.exportCurrentFile.addEventListener('click', () => exportTabsToFile('current'));
  els.exportAllFile.addEventListener('click', () => exportTabsToFile('all'));
  els.exportJsonCurrent.addEventListener('click', () => exportTabsToJsonFile('current'));
  els.exportJsonAll.addEventListener('click', () => exportTabsToJsonFile('all'));
});
