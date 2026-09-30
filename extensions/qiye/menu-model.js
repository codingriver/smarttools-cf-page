import { entries, findEntry } from './bookmark-document.js';
// Pure menu/target operations, shared with acceptance tests.
export function httpUrl(value, base) {
  try { const url = new URL(value, base); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function menuTargets(snapshot) {
  if (!snapshot?.document) return [];
  return entries(snapshot.document).filter(e => e.node.type === 'folder').map(e => ({
    title: e.path.map(n => n.title).join(' / ') + (e.isPrivate ? ' 🔒' : '') + (e.hidden ? ' · 隐藏' : ''),
    id: e.node.id, parentId: e.parent?.id || null,
    entries: [{ title: '＋ 收藏到此处', target: { containerId: e.node.id, private: e.isPrivate } }]
  }));
}
export function resolveTarget(document, target) {
  const entry = findEntry(document, target.containerId);
  if (!entry || entry.node.type !== 'folder' || entry.isPrivate !== target.private) throw new Error('收藏位置或 Private 属性已变化，请刷新菜单');
  return { container: entry.node, items: entry.node.children };
}
export function captureItem(info, tab) {
  const url = httpUrl(info.linkUrl || tab?.url);
  if (!url) throw new Error('仅支持收藏 HTTP(S) 网页或链接');
  return { url, title: info.linkUrl ? url : (tab?.title || url) };
}
export function appendCapture(document, target, item, site, id) {
  const { items } = resolveTarget(document, target);
  if (items.some(node => httpUrl(node.url, site) === item.url)) return false;
  items.push({ id, type: 'bookmark', title: item.title, url: item.url }); return true;
}
