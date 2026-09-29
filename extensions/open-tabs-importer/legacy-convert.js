import { validateDocument, safeLink } from './bookmark-document.js';
// One-way literal-data conversion only. Never execute legacy source or decode ciphertext.
export function convertSections(sections, updatedAt = 0) {
  if (!Array.isArray(sections)) throw new Error('旧数据缺少 sections');
  const ids = new Set(); let serial = 0;
  const id = old => { let value = typeof old === 'string' && old && old.length <= 200 && !ids.has(old) ? old : `migrated-${++serial}`; while (ids.has(value)) value = `migrated-${++serial}`; ids.add(value); return value; };
  const encrypted = node => node && (node.encrypted === true || node.locked === true || Object.hasOwn(node, 'enc') || Object.hasOwn(node, '_enc'));
  // Preserve opaque legacy fields, but never carry old encrypted child containers forward.
  function retainedLegacy(old, depth = 1) {
    if (depth > 32) throw new Error('旧数据结构或层级无效');
    return Object.fromEntries(Object.entries(old).filter(([key]) => key !== 'updatedAt').map(([key, value]) => {
      if (['cards', 'subCards'].includes(key) && Array.isArray(value)) {
        value = value.filter(child => !encrypted(child)).map(child => child && typeof child === 'object' && !Array.isArray(child) ? retainedLegacy(child, depth + 1) : child);
      }
      return [key, value];
    }));
  }
  const known = new Set(['id','key','type','title','label','content','kind','cards','subCards','private','visible','url','desc','descUrl','comment','note','icon','iconImg','updatedAt']);
  function node(old, root = false, depth = 1, kind = 'card') {
    if (!old || typeof old !== 'object' || Array.isArray(old) || depth > 32) throw new Error('旧数据结构或层级无效');
    if (encrypted(old)) return null;
    const title = String(old.title || old.label || old.content || old.url || '未命名');
    const supported = kind === 'card' && (!old.type || ['simple','compact','desc-clickable','expandable'].includes(old.type));
    const folder = root || (supported && (old.type === 'expandable' || Array.isArray(old.subCards) && old.subCards.length > 0));
    const out = { id: id(old.id || (root ? old.key : null)), type: folder ? 'folder' : 'bookmark', title };
    const extra = Object.fromEntries(Object.entries(old).filter(([key]) => !known.has(key)));
    if (Object.keys(extra).length) out.extensions = { legacy: extra };
    for (const key of ['desc','comment','note','icon']) if (old[key] !== undefined) out[key] = String(old[key]);
    for (const key of ['url','descUrl','iconImg']) if (old[key] && safeLink(old[key])) out[key] = String(old[key]);
    const unsafe = Object.fromEntries(['url','descUrl','iconImg'].filter(key => old[key] && !safeLink(old[key])).map(key => [key, old[key]]));
    if (Object.keys(unsafe).length) out.extensions = { ...out.extensions, rejectedLinks: unsafe };
    if (folder) {
      out.isPrivate = old.private === true; out.visible = old.visible !== false;
      const children = root ? old.cards : old.subCards || [];
      if (!Array.isArray(children)) throw new Error('旧容器缺少子节点数组');
      out.children = children.map(child => node(child, false, depth + 1, root ? old.kind || 'card' : kind)).filter(Boolean);
      if (!supported) out.extensions = { ...out.extensions, legacyType: old.type };
      if (root && old.kind && old.kind !== 'card') out.extensions = { ...out.extensions, legacyKind: old.kind };
    } else if (!supported || !out.url) {
      out.type = 'legacy'; out.extensions = { ...out.extensions, legacyData: retainedLegacy(old) };
    }
    if (old.type === 'desc-clickable') out.extensions = { ...out.extensions, presentation: 'desc-clickable' };
    return out;
  }
  return validateDocument({ schemaVersion: 2, updatedAt, roots: sections.map(item => node(item, true)).filter(Boolean) });
}
