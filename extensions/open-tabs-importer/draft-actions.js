import { supportedCard, safeUrl } from './model.js';

export const isFolder = card => card?.type === 'expandable';
export const isLeaf = card => !!card && !card.subCards?.length && (!card.type || ['simple', 'compact'].includes(card.type));
export const privateWarning = (from, to) => !from.private || to.private || confirm('这会将 Private 内容移入公开分组，匿名访问者保存后将可见。确认继续？');
export function validateCard(values, card, base) {
  if (!String(values.title || values.content || '').trim()) throw new Error('请输入标题');
  for (const key of ['url', 'descUrl', 'iconImg']) if (values[key] && !safeUrl(values[key], base)) throw new Error('URL 不安全或格式错误');
  if (card?.subCards?.length && values.type && values.type !== 'expandable') throw new Error('存在子卡片，请保留展开类型，或先移动/删除子卡片');
}
export function canMove(from, card, parent, to) {
  return from?.kind === 'card' && to?.section?.kind === 'card' && supportedCard(card, !!parent)
    && (!parent || from.cards.includes(parent)) && (parent ? parent.subCards : from.cards)?.includes(card)
    && (!to.parent || (to.parent !== card && isFolder(to.parent) && to.section.cards.includes(to.parent) && isLeaf(card)))
    && (!parent || isLeaf(card));
}
// Object identities belong to a page's cloned draft, never a filtered DOM index or a cached object.
export function moveItem(sections, from, card, parent, to, before = null, consent = privateWarning) {
  if (!sections.includes(from) || !sections.includes(to?.section) || !canMove(from, card, parent, to)) throw new Error('此位置不支持移动该卡片');
  const source = parent ? parent.subCards : from.cards;
  const target = to.parent ? (to.parent.subCards || []) : to.section.cards;
  if (before && !target.includes(before)) throw new Error('目标已变化，请重新操作');
  if (before === card || !consent(from, to.section)) return false;
  if (source === target && ((!before && target.at(-1) === card) || target[target.indexOf(card) + 1] === before)) return false;
  if (to.parent && !to.parent.subCards) to.parent.subCards = target;
  source.splice(source.indexOf(card), 1);
  if (to.parent) card.type = 'compact'; else if (card.type === 'compact') card.type = 'simple';
  target.splice(before ? target.indexOf(before) : target.length, 0, card);
  return true;
}
export function reorderBefore(items, item, before = null) {
  if (!items.includes(item) || (before && !items.includes(before)) || item === before) return false;
  if ((!before && items.at(-1) === item) || items[items.indexOf(item) + 1] === before) return false;
  items.splice(items.indexOf(item), 1); items.splice(before ? items.indexOf(before) : items.length, 0, item); return true;
}
export async function saveDraft(state, remote) {
  if (state.connectionIssue) throw new Error('连接异常，请先检查连接与云端；当前草稿保留');
  if (!state.loggedIn || !state.hasKV || !state.etag || !state.dirty) throw new Error('请先登录并加载可写云端版本');
  const initialize = state.source !== 'kv';
  if (initialize) throw new Error('请在网站完整后台保存到 KV 并切换数据源');
  return remote('save', { sections: state.sections, baseEtag: state.etag, baseSource: state.configured, initialize });
}
