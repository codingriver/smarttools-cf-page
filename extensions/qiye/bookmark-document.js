// Portable, authoritative v2 document rules. Imported by Pages and extension; no runtime dependencies.
export const SCHEMA_VERSION = 2;
export const MAX_DEPTH = 32;
export const MAX_BYTES = 20 * 1024 * 1024;
export const cloneDocument = value => structuredClone(value);
export const emptyDocument = () => ({ schemaVersion: 2, updatedAt: 0, roots: [] });
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const businessContent = document => JSON.stringify(canonical({ schemaVersion: document.schemaVersion, roots: document.roots }));
export function safeLink(value, base = 'https://example.invalid/') {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const url = new URL(value, base); return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
const record = value => value && typeof value === 'object' && !Array.isArray(value);
export function validateDocument(document) {
  const invalid = message => { throw Object.assign(new Error(message), { status: 422, code: 'INVALID_DOCUMENT' }); };
  if (!record(document) || document.schemaVersion !== 2 || !Number.isSafeInteger(document.updatedAt) || document.updatedAt < 0 || !Array.isArray(document.roots)) invalid('无效的书签文档');
  if (Object.keys(document).some(k => !['schemaVersion', 'updatedAt', 'roots'].includes(k))) invalid('未知的文档顶层字段');
  // Bound arbitrary preserved extension payloads too, before canonicalization or serialization.
  const seen = new Set();
  function json(value, depth = 0) {
    if (depth > 80) invalid('数据嵌套过深');
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
    if (!value || typeof value !== 'object' || seen.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) invalid('文档必须是无循环的 JSON 数据');
    seen.add(value); for (const child of Object.values(value)) json(child, depth + 1); seen.delete(value);
  }
  json(document);
  const ids = new Set();
  function walk(nodes, depth) {
    if (depth > MAX_DEPTH) invalid('书签层级不能超过 32 层');
    for (const node of nodes) {
      if (!record(node) || typeof node.id !== 'string' || !node.id || node.id.length > 200 || ids.has(node.id)) invalid('节点 ID 缺失或重复');
      ids.add(node.id);
      if (typeof node.title !== 'string' || !node.title.trim()) invalid('节点标题不能为空');
      if (Object.hasOwn(node, 'updatedAt')) invalid('更新时间只能位于文档顶层');
      if (!['folder', 'bookmark', 'legacy'].includes(node.type) || (depth === 1 && node.type !== 'folder')) invalid('无效的节点类型');
      for (const key of ['url', 'descUrl', 'iconImg']) if (node[key] !== undefined && (typeof node[key] !== 'string' || (node[key] && !safeLink(node[key])))) invalid('无效或不安全的链接');
      for (const key of ['desc', 'comment', 'note', 'icon']) if (node[key] !== undefined && typeof node[key] !== 'string') invalid('无效的文本字段');
      if (node.type === 'folder') {
        if (typeof node.isPrivate !== 'boolean' || typeof node.visible !== 'boolean' || !Array.isArray(node.children)) invalid('容器缺少私有、可见性或子节点字段');
        if (node.children.length) walk(node.children, depth + 1);
      } else {
        if (Object.hasOwn(node, 'children') || Object.hasOwn(node, 'isPrivate')) invalid('只有容器可以保存子节点和私有属性');
        if (node.type === 'bookmark' && (!node.url || !safeLink(node.url))) invalid('书签必须包含安全的 URL');
      }
    }
  }
  walk(document.roots, 1);
  if (new TextEncoder().encode(JSON.stringify(document)).byteLength > MAX_BYTES) throw Object.assign(new Error('书签文档超过 20 MiB'), { status: 413, code: 'DOCUMENT_TOO_LARGE' });
  return document;
}
export function entries(document) {
  const result = [];
  function visit(nodes, parent, path, inheritedPrivate, hidden) {
    for (const node of nodes) {
      const entry = { node, parent, path: [...path, node], isPrivate: inheritedPrivate || node.isPrivate === true, hidden: hidden || node.visible === false };
      result.push(entry);
      if (node.type === 'folder') visit(node.children, node, entry.path, entry.isPrivate, entry.hidden);
    }
  }
  visit(document.roots, null, [], false, false); return result;
}
export const findEntry = (document, id) => entries(document).find(entry => entry.node.id === id);
export function canMoveNode(document, id, targetId) {
  const source = findEntry(document, id), target = targetId === null ? null : findEntry(document, targetId);
  if (!source || (targetId !== null && target?.node.type !== 'folder') || (!target && source.node.type !== 'folder')) return false;
  if (target?.path.some(node => node.id === id)) return false;
  const subtreeDepth = node => node.type === 'folder' && node.children.length ? 1 + node.children.reduce((max, child) => Math.max(max, subtreeDepth(child)), 0) : 1;
  return (target?.path.length || 0) + subtreeDepth(source.node) <= MAX_DEPTH;
}
export function moveNode(document, id, targetId, beforeId = null, consent = () => true) {
  if (!canMoveNode(document, id, targetId)) throw new Error('不能移入自身、后代或无效容器');
  const source = findEntry(document, id), target = targetId === null ? null : findEntry(document, targetId);
  const from = source.parent?.children || document.roots, to = target?.node.children || document.roots;
  if (beforeId !== null && !to.some(node => node.id === beforeId)) throw new Error('排序目标不存在');
  if (beforeId === id || (from === to && (beforeId === (to[to.indexOf(source.node) + 1]?.id || null)))) return false;
  if (source.isPrivate && !target?.isPrivate && !source.node.isPrivate && !consent()) return false;
  from.splice(from.indexOf(source.node), 1); to.splice(beforeId === null ? to.length : to.findIndex(node => node.id === beforeId), 0, source.node); return true;
}
