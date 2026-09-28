// Pure draft operations. Unknown fields are retained; drafts never mutate the confirmed shared cache.
export const clone = value => structuredClone(value);
export const metadata = section => { const { cards, ...meta } = section; return meta; };
export function deltaPayload(baseline, current) {
  const previous = new Map(baseline.map(s => [s.key, JSON.stringify(s)]));
  return {
    mode: 'sections', sectionsMeta: current.map(metadata),
    changedSections: current.filter(s => previous.get(s.key) !== JSON.stringify(s)).map(s => ({ key: s.key, meta: metadata(s), cards: s.cards })),
    deletedSectionKeys: baseline.filter(s => !current.some(c => c.key === s.key)).map(s => s.key)
  };
}
export function supportedCard(card, child = false) {
  return !!card && typeof card === 'object' && (child
    ? (!card.subCards?.length && (!card.type || ['compact', 'simple'].includes(card.type)))
    : (!card.type || ['simple', 'desc-clickable', 'expandable'].includes(card.type)));
}
export function matches(card, query) {
  return ['title', 'content', 'url', 'desc', 'descUrl', 'comment', 'note'].some(k => String(card[k] || '').toLowerCase().includes(query))
    || (Array.isArray(card.subCards) && card.subCards.some(c => matches(c, query)));
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
// Read-only library views; never reorder or mutate the persisted section/card arrays.
export function libraryView(sections, { scope = 'all', selected = '', query = '' } = {}) {
  const entries = sections.flatMap(section => section.cards.map(card => ({ section, card })));
  const counts = {
    all: entries.length,
    private: entries.filter(({ section }) => section.private).length,
    children: entries.filter(({ card }) => card.subCards?.length).length,
    hidden: entries.filter(({ section }) => section.visible === false).length
  };
  const normalized = query.trim().toLowerCase();
  const visible = entries.filter(({ section, card }) => normalized ? matches(card, normalized)
    : scope === 'group' ? section.key === selected
    : scope === 'private' ? section.private
    : scope === 'hidden' ? section.visible === false
    : scope === 'children' ? !!card.subCards?.length : true);
  return { entries: visible, counts, childCount: visible.reduce((sum, { card }) => sum + (card.subCards?.length || 0), 0) };
}
