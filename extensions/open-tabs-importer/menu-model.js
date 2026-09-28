// Pure menu/target operations, shared with acceptance tests.
export function httpUrl(value, base) {
  try { const url = new URL(value, base); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const fingerprint = card => JSON.stringify(canonical(card));
export function parentReference(card) {
  return card.id ? { id: card.id } : { fingerprint: fingerprint(card) };
}
export function menuTargets(snapshot) {
  const groups = [];
  for (const section of snapshot?.sections || []) {
    if (section.kind !== 'card') continue;
    const target = { sectionKey: section.key, private: section.private === true };
    groups.push({ title: String(section.label || section.key) + (section.private ? ' 🔒' : '') + (section.visible === false ? ' · 隐藏' : ''),
      entries: [{ title: '＋ 收藏为独立卡片', target }, ...section.cards.filter(c => c.type === 'expandable').map(card => ({
        title: `添加到「${String(card.title || card.content || '未命名卡片')}」的子卡片`,
        target: { ...target, parent: parentReference(card) }
      }))] });
  }
  return groups;
}
export function resolveTarget(sections, target) {
  const found = sections.filter(s => s.key === target.sectionKey);
  const section = found[0];
  if (found.length !== 1 || section.kind !== 'card' || (section.private === true) !== target.private) throw new Error('收藏位置已变化，请刷新菜单后重试');
  if (!target.parent) return { section, items: section.cards };
  const parents = section.cards.filter(c => target.parent.id ? c.id === target.parent.id : fingerprint(c) === target.parent.fingerprint);
  if (parents.length !== 1 || parents[0].type !== 'expandable') throw new Error('父卡片已变化或无法唯一识别，请刷新菜单或整理数据');
  const parent = parents[0];
  parent.subCards ||= [];
  return { section, parent, items: parent.subCards };
}
export function captureItem(info, tab) {
  const url = httpUrl(info.linkUrl || tab?.url);
  if (!url) throw new Error('仅支持收藏 HTTP(S) 网页或链接');
  return { url, title: info.linkUrl ? url : (tab?.title || url) };
}
export function appendCapture(sections, target, item, site, id) {
  const { items, parent } = resolveTarget(sections, target);
  if (items.some(card => httpUrl(card.url, site) === item.url)) return false;
  items.push(parent ? { id, type: 'compact', content: item.title, url: item.url } : { id, type: 'simple', title: item.title, url: item.url });
  return true;
}
