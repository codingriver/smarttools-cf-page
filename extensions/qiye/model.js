// Pure draft operations. Unknown fields are retained; drafts never mutate the confirmed shared cache.
export const clone = value => structuredClone(value);
export function supportedCard(card) { return !!card && ['bookmark', 'folder'].includes(card.type); }
export function matches(card, query) {
  return ['title', 'content', 'url', 'desc', 'descUrl', 'comment', 'note'].some(k => String(card[k] || '').toLowerCase().includes(query))
    || (Array.isArray(card.children) && card.children.some(c => matches(c, query)));
}
export function reorder(items, index, offset) {
  const next = index + offset;
  if (next < 0 || next >= items.length) return false;
  [items[index], items[next]] = [items[next], items[index]]; return true;
}
export function safeUrl(value, origin) {
  if (!value) return null;
  try { const url = new URL(value, origin); return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
