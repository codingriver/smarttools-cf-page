// Local document exchange only: never read credentials, write cache, or call an API.
import { validateDocument, MAX_BYTES, cloneDocument, businessContent, entries } from './bookmark-document.js';
const size = text => new TextEncoder().encode(text).byteLength;
const tooLarge = () => new Error('JSON 文件不能超过 20 MiB');
export function parseBookmarkJson(text) {
  if (typeof text !== 'string' || size(text) > MAX_BYTES) throw tooLarge();
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('文件不是有效的 JSON，请检查语法；不支持 JavaScript 或旧版 sections 数据'); }
  try { return validateDocument(value); }
  catch (error) { throw new Error('书签 JSON 校验失败：' + error.message + '。请选择包含 schemaVersion: 2、updatedAt、roots 的完整文档，不要使用 KV 或缓存外壳'); }
}
export async function readBookmarkFile(file) {
  if (!file || !/\.json$/i.test(file.name || '')) throw new Error('请选择 .json 格式的书签文件');
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_BYTES) throw tooLarge();
  let text;
  try { text = await file.text(); } catch { throw new Error('无法读取 JSON 文件；当前数据未改变，请重新选择'); }
  return parseBookmarkJson(text);
}
export function exportBookmarkJson(document) {
  validateDocument(document);
  const pretty = JSON.stringify(document, null, 2);
  // Ensure that even a near-limit export can be imported by the same size guard.
  return size(pretty) <= MAX_BYTES ? pretty : JSON.stringify(document);
}
export function prepareImportedDraft(document, baseline) {
  validateDocument(document); validateDocument(baseline);
  const draft = cloneDocument(document);
  // Imported time is not proof of a cloud update. Keep this page's confirmed version/time.
  draft.updatedAt = baseline.updatedAt;
  return { document: draft, dirty: businessContent(draft) !== businessContent(baseline) };
}
export function importDescription(document) {
  const nodes = entries(document);
  const folders = nodes.filter(({ node }) => node.type === 'folder').length;
  return `${document.roots.length} 个分类、${folders - document.roots.length} 个文件夹、${nodes.length - folders} 个书签或只读节点`;
}
