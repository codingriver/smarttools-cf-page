// Only fixed built-in pages can be opened; never navigate an existing editor away.
export async function openExtensionPage(page) {
  if (page !== 'start.html') throw new Error('不支持的扩展页面');
  const url = chrome.runtime.getURL(page);
  const tab = (await chrome.tabs.query({})).find(item => item.url === url);
  if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
  else await chrome.tabs.create({ url, active: true });
}
