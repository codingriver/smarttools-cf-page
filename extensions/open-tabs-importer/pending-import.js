// Guard: only run in extension context with chrome.storage available
if (!(chrome && chrome.storage && chrome.storage.local)) {
  window.addEventListener('message', function noop() {});
} else {
  function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  function normalizePagePath(pathname) {
    var path = String(pathname || '/').replace(/\/+$/, '') || '/';
    return path.toLowerCase();
  }

  function sameConfigPath(currentPathname, targetPathname) {
    var currentPath = normalizePagePath(currentPathname);
    var targetPath = normalizePagePath(targetPathname);
    if (currentPath === targetPath) return true;
    return (currentPath === '/config' || currentPath === '/config.html')
      && (targetPath === '/config' || targetPath === '/config.html');
  }

  async function getPendingPayloadForCurrentPage() {
    var data = await chrome.storage.local.get('pendingOpenTabsImport');
    var payload = data.pendingOpenTabsImport;
    var configured = await chrome.storage.sync.get('configUrl');
    if (!payload || !payload.configUrl || payload.configUrl !== configured.configUrl) return null;

    var current = new URL(window.location.href);
    var target = new URL(payload.configUrl);
    if (current.origin !== target.origin || !sameConfigPath(current.pathname, target.pathname)) return null;
    return payload;
  }

  function toExtensionMessage(payload) {
    return {
      source: 'smarttools-open-tabs-extension',
      scope: payload.scope,
      sentAt: payload.sentAt,
      tabs: payload.tabs || []
    };
  }

  async function deliverPendingImport(retryCount) {
    try {
      var payload = await getPendingPayloadForCurrentPage();
      if (!payload) return;
      var message = toExtensionMessage(payload);
      for (var i = 0; i < retryCount; i++) {
        window.postMessage(message, window.location.origin);
        await sleep(500);
      }
    } catch (e) {
      // Ignore errors on non-SmartTools pages
    }
  }

  deliverPendingImport(6);

  window.addEventListener('message', async function(event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.source !== 'smarttools-open-tabs-page' || event.origin !== location.origin) return;
    if (!await getPendingPayloadForCurrentPage()) return;
    if (data.action === 'pending-received') {
      chrome.storage.local.remove('pendingOpenTabsImport');
      return;
    }
    if (data.action === 'request-pending') {
      deliverPendingImport(3);
    }
  });
}
