import { safeUrl } from './model.js';
import { findEntry, canMoveNode, moveNode, validateDocument } from './bookmark-document.js';
export const isFolder = node => node?.type === 'folder';
export const isLeaf = node => node?.type === 'bookmark';
export const privateWarning = (from, to) => !from.isPrivate || to?.isPrivate || confirm('这会解除内容继承的 Private 保护并移入公开容器。确认继续？');
export function validateCard(values) {
  if (!String(values.title || '').trim()) throw new Error('请输入标题');
  for (const key of ['url', 'descUrl', 'iconImg']) if (values[key] && !safeUrl(values[key], 'https://example.invalid/')) throw new Error('URL 不安全或格式错误');
}
export function canMove(document, card, to) {
  return !!card && !!to?.section && canMoveNode(document, card.id, (to.parent || to.section).id);
}
export function moveItem(document, card, to, before = null) {
  return moveNode(document, card.id, (to.parent || to.section).id, before?.id || null, () => confirm('将内容移出继承的 Private 容器后，它将不再私有。确认？'));
}
export function reorderBefore(items, item, before = null) {
  if (!items.includes(item) || (before && !items.includes(before)) || item === before) return false;
  if ((!before && items.at(-1) === item) || items[items.indexOf(item) + 1] === before) return false;
  items.splice(items.indexOf(item), 1); items.splice(before ? items.indexOf(before) : items.length, 0, item); return true;
}
export async function saveDraft(state, remote) {
  if (state.connectionIssue) throw new Error('连接异常，请先核对云端；当前草稿保留');
  if (!state.loggedIn || !state.hasKV || !state.etag || !state.dirty) throw new Error('请先登录并加载可写云端版本');
  validateDocument(state.document);
  return remote('save', { document: state.document, baseEtag: state.etag });
}
