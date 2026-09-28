import { registerImporter, sitePattern } from './site.js';
function sameConfigPage(tabUrl, configUrl) {
  try {
    const a = new URL(tabUrl || '');
    const b = new URL(configUrl || '');
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

async function postPayloadToTab(tabId, payload) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: data => {
      window.postMessage(data, window.location.origin);
    },
    args: [{
      source: 'smarttools-open-tabs-extension',
      scope: payload.scope,
      sentAt: payload.sentAt,
      tabs: payload.tabs || []
    }]
  });
}

async function tryDeliverPending(tabId, tabUrl) {
  const storageData = chrome.storage && chrome.storage.local
    ? await chrome.storage.local.get('pendingOpenTabsImport')
    : {};
  const payload = storageData.pendingOpenTabsImport;
  const configured = await chrome.storage.sync.get('configUrl');
  if (!payload || payload.configUrl !== configured.configUrl || !sameConfigPage(tabUrl, payload.configUrl)) return;
  if (!await chrome.permissions.contains({ origins: [sitePattern(payload.configUrl)] })) return;

  for (let i = 0; i < 8; i++) {
    try {
      await postPayloadToTab(tabId, payload);
    } catch (e) {
      // Page may still be initializing; retry below.
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  tryDeliverPending(tabId, tab.url);
});

let registration = Promise.resolve();
function syncRegistration() {
  registration = registration.catch(() => {}).then(async () => {
    const { configUrl } = await chrome.storage.sync.get('configUrl');
    await registerImporter(configUrl);
  }).catch(() => {});
  return registration;
}
chrome.runtime.onInstalled.addListener(syncRegistration);
chrome.runtime.onStartup.addListener(syncRegistration);
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && changes.configUrl) syncRegistration(); });
chrome.permissions.onRemoved.addListener(syncRegistration);
chrome.permissions.onAdded.addListener(syncRegistration);

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')) || message?.action !== 'refresh-import-registration') return;
  syncRegistration().then(() => reply({ ok: true }));
  return true;
});
import { initializeClient } from './cache-controller.js';
initializeClient();
