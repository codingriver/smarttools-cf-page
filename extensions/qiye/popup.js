import { openExtensionPage } from './navigation.js';
import { client } from './client.js';
import { DEFAULT_CONFIG_URL, normalizeConfigUrl, authorizeSite } from './site.js';

function requireElement(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required popup element: #${id}`);
  return el;
}

const els = {
  configUrl: requireElement('configUrl'),
  saveUrl: requireElement('saveUrl'),
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

async function getConfigUrl() {
  const data = await chrome.storage.sync.get({ configUrl: DEFAULT_CONFIG_URL });
  return normalizeConfigUrl(data.configUrl);
}

async function saveConfigUrl() {
  try {
    const configUrl = await authorizeSite(els.configUrl.value);
    await chrome.storage.sync.set({ configUrl });
    els.configUrl.value = configUrl;
    setStatus('服务端地址已保存', 'ok');
  } catch (e) {
    setStatus(e.message, 'err');
  }
}

async function openHome() {
  await openExtensionPage('start.html');
  setStatus('已打开浏览主页', 'ok');
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

async function collectTabs(scope) {
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
    .filter(tab => isImportableUrl(tab.url))
    .map(toPayloadTab);
}

// Copy to clipboard as JSON
async function copyTabsToClipboard(scope) {
  const tabs = await collectTabs(scope);
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
  const tabs = await collectTabs(scope);
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
  const tabs = await collectTabs(scope);
  if (!tabs.length) {
    setStatus('没有可导出的普通网页标签', 'err');
    return;
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `qiye-tabs-${scope === 'current' ? 'current' : 'all'}-${timestamp}.html`;

  const html = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<!-- Qiye Tabs Export -->',
    '<TITLE>栖页书签</TITLE>',
    '<H1>栖页书签</H1>',
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
  const tabs = await collectTabs(scope);
  if (!tabs.length) {
    setStatus('没有可导出的普通网页标签', 'err');
    return;
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `qiye-tabs-${scope === 'current' ? 'current' : 'all'}-${timestamp}.json`;
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
  try { els.configUrl.value = await getConfigUrl(); }
  catch (error) { els.configUrl.value = DEFAULT_CONFIG_URL; setStatus(error.message, 'err'); }
  els.saveUrl.addEventListener('click', saveConfigUrl);
  requireElement('openStart').addEventListener('click', () => openHome());
  els.copyCurrent.addEventListener('click', () => copyTabsToClipboard('current'));
  els.copyAll.addEventListener('click', () => copyTabsToClipboard('all'));
  els.copyTextCurrent.addEventListener('click', () => copyTabsAsText('current'));
  els.copyTextAll.addEventListener('click', () => copyTabsAsText('all'));
  els.exportCurrentFile.addEventListener('click', () => exportTabsToFile('current'));
  els.exportAllFile.addEventListener('click', () => exportTabsToFile('all'));
  els.exportJsonCurrent.addEventListener('click', () => exportTabsToJsonFile('current'));
  els.exportJsonAll.addEventListener('click', () => exportTabsToJsonFile('all'));
});

async function showCaptureStatus() {
  try {
    const value = await client('status.get', await getConfigUrl());
    document.getElementById('captureStatus').textContent = value ? value.text + ' · ' + new Date(value.at).toLocaleString() : '右键网页或链接即可收藏；云端写入需要登录。';
  } catch (error) { document.getElementById('captureStatus').textContent = error.message; }
}
async function showCacheStatus(sync = false) {
  try {
    const configUrl = await getConfigUrl();
    const cached = await client('cache.get', configUrl);
    document.getElementById('cacheStatus').textContent = cached ? `本机缓存：${(cached.document?.roots || cached.sections || []).length} 个分组 · ${new Date(cached.savedAt).toLocaleString()}` : '尚无本机缓存';
    if (sync) {
      const result = await client('sync', configUrl);
      document.getElementById('cacheStatus').textContent = result.warning || (result.loggedIn ? '已连接云端，收藏位置已就绪' : '未登录；已有本机缓存和收藏位置仍保留');
    }
  } catch (error) { document.getElementById('cacheStatus').textContent += ' · ' + error.message; }
}
document.addEventListener('DOMContentLoaded', async () => { await showCaptureStatus(); await showCacheStatus(true); });
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('background.js') || message?.channel !== 'qiye-cache-event') return;
  if (message.type === 'status') showCaptureStatus();
  if (['changed', 'cleared'].includes(message.type)) showCacheStatus();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.configUrl) showCacheStatus(true);
});
