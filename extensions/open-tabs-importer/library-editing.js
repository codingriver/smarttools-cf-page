import { entries, findEntry, canMoveNode, moveNode, validateDocument } from './bookmark-document.js';
import { validateCard } from './draft-actions.js';
export function createEditing({ state, dialog, changed, clearSearch = () => {} }) {
  const rootFor = node => findEntry(state.document, node.id)?.path[0];
  const warning = () => confirm('此操作会解除部分内容继承的 Private 保护。确认继续？');
  function fields(node, folder) {
    const result = [
      { name: 'title', label: folder ? '容器名称' : '标题', value: node?.title, required: true },
      { name: 'url', label: folder ? '主链接（可选）' : 'URL（HTTP(S)、mailto 或站点相对地址）', value: node?.url, required: !folder },
      { name: 'desc', label: '描述', value: node?.desc, multiline: true },
      ...['comment','note','icon','iconImg','descUrl'].map(name => ({ name, label: { comment:'注释', note:'备注', icon:'文字图标', iconImg:'图片图标地址', descUrl:'描述链接' }[name], advanced: true, value: node?.[name] }))
    ];
    if (folder) result.push({ name: 'visible', label: '显示容器', checkbox: true, value: node?.visible !== false }, { name: 'isPrivate', label: 'Private（向后代继承，不是加密）', checkbox: true, value: node?.isPrivate === true });
    return result;
  }
  function edit(parent, node = null, folder = false) {
    if (node?.type === 'legacy') return;
    folder = node ? node.type === 'folder' : folder;
    dialog(node ? '编辑' + (folder ? '容器' : '书签') : '新建' + (folder ? '容器' : '书签'), fields(node, folder), values => {
      validateCard(values);
      if (node?.isPrivate && !values.isPrivate && !warning()) return false;
      const created = { ...(node || { id: crypto.randomUUID(), type: folder ? 'folder' : 'bookmark', ...(folder ? { children: [] } : {}) }), ...values };
      // Validate a candidate first: rejected edits never mutate the draft.
      const candidate = structuredClone(state.document);
      if (node) Object.assign(findEntry(candidate, node.id).node, created);
      else (parent ? findEntry(candidate, parent.id).node.children : candidate.roots).push(created);
      validateDocument(candidate);
      if (node) Object.assign(node, created); else (parent?.children || state.document.roots).push(created);
      state.selected = (parent ? rootFor(parent) : created).id; clearSearch();
    }, false, parent ? '位置：' + findEntry(state.document, parent.id).path.map(n => n.title).join(' / ') : '根分类');
  }
  function editGroup(node = null) { edit(null, node, true); }
  function editCard(section, card = null, parent = null, folder = false) {
    if (!section) { editGroup(); return; }
    edit(parent || section, card, folder);
  }
  function moveCard(section, card) {
    const options = entries(state.document).filter(e => e.node.type === 'folder' && canMoveNode(state.document, card.id, e.node.id));
    const choices = options.map(e => [e.node.id, e.path.map(n => n.title).join(' / ') + (e.isPrivate ? ' · Private' : '')]);
    if (card.type === 'folder' && findEntry(state.document, card.id).parent) choices.unshift(['', '根分类（移出为独立分类）']);
    dialog('移动到容器', [{ name: 'target', label: '目标分类 / 文件夹', options: choices }], values => {
      const target = values.target || null;
      if (!moveNode(state.document, card.id, target, null, warning)) return false;
      state.selected = target ? findEntry(state.document, target).path[0].id : card.id;
    });
  }
  function remove(node) {
    const entry = findEntry(state.document, node.id); if (!entry) return;
    const items = entry.parent?.children || state.document.roots;
    if (node.type === 'folder' && node.children.length) {
      const targets = entries(state.document).filter(e => e.node.type === 'folder' && !e.path.includes(node));
      dialog('删除容器：' + node.title, [{ name: 'target', label: '内容处理方式', options: [['delete','删除容器及全部内容'], ...targets.map(e => [e.node.id, '迁移至 ' + e.path.map(n => n.title).join(' / ') + (e.isPrivate ? ' · Private' : '')])] }], values => {
        const dest = values.target === 'delete' ? null : findEntry(state.document, values.target);
        if (values.target !== 'delete' && !dest) throw new Error('目标已变化');
        if (dest && entry.isPrivate && !dest.isPrivate && !warning()) return false;
        if (!confirm('确认删除容器？云端在点击保存后才更新。')) return false;
        if (dest) {
          const candidate = structuredClone(state.document);
          for (const child of node.children) moveNode(candidate, child.id, dest.node.id);
          validateDocument(candidate);
          dest.node.children.push(...node.children);
        }
        items.splice(items.indexOf(node), 1);
      });
    } else if (confirm('确认删除？云端在点击保存后才更新。')) { items.splice(items.indexOf(node), 1); changed(); }
  }
  return { editGroup, deleteGroup: remove, editCard, moveCard, deleteCard: (section, node) => remove(node) };
}
