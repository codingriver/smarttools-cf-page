import { privateWarning, validateCard, isFolder, isLeaf, canMove, moveItem } from './draft-actions.js';
export function createEditing({ state, dialog, changed, clearSearch = () => {} }) {
function editGroup(s = null) {
  dialog(s ? '编辑分组' : '新建分组', [
    { name: 'label', label: '分组名称', value: s?.label, required: true },
    { name: 'anchor', label: '页面锚点', value: s?.anchor },
    { name: 'visible', label: '显示分组', value: s ? s.visible !== false : true, checkbox: true },
    { name: 'private', label: 'Private（仅管理员可见，不是加密）', value: s?.private, checkbox: true },
    { name: 'dynamic', label: '允许展开卡片', value: s?.dynamic, checkbox: true }
  ], values => {
    if (!values.label.trim()) throw new Error('请输入分组名称');
    if (s?.private && !values.private && !confirm('将 Private 分组公开后，匿名用户可以读取其中内容。确认？')) return false;
    if (s) Object.assign(s, values); else { const created = { key: 'group_' + crypto.randomUUID(), kind: 'card', ...values, cards: [] }; state.sections.push(created); state.selected = created.key; state.scope = 'group'; }
  });
}
function deleteGroup(s) {
  const options = [['delete', '删除分组及全部内容'], ...state.sections.filter(t => t !== s && t.kind === s.kind).map(t => [t.key, `迁移到：${t.label}${t.private ? ' · Private' : ' · 公开'}`])];
  dialog(`删除分组：${s.label}`, [{ name: 'target', label: `包含 ${s.cards.length} 个书签。请选择处理方式`, options }], values => {
    const target = state.sections.find(t => t.key === values.target);
    if (target && !privateWarning(s, target)) return false;
    if (!confirm(target ? '确认迁移全部内容并删除分组？' : `确认删除${s.private ? ' Private' : ''}分组及全部内容？`)) return false;
    if (target) target.cards.push(...s.cards);
    state.sections.splice(state.sections.indexOf(s), 1); state.selected = target?.key || state.sections[0]?.key || '';
  });
}
function editCard(s, card = null, parent = null, folder = false) {
  if (!s || s.kind !== 'card') s = state.sections.find(section => section.kind === 'card');
  if (!s) { editGroup(); return; }
  const child = !!parent;
  const fields = [
    { name: 'title', label: '标题', value: card?.title || card?.content, required: true },
    { name: 'url', label: 'URL（HTTP(S)、mailto 或站点相对地址）', value: card?.url },
    { name: 'desc', label: '描述', value: card?.desc, multiline: true },
    { name: 'comment', advanced: true, label: '注释', value: card?.comment, multiline: true },
    { name: 'icon', advanced: true, label: '文字 / Emoji 图标（已有 SVG 原样保留）', value: card?.icon },
    { name: 'iconImg', advanced: true, label: '图片图标 URL（相对路径按站点解析）', value: card?.iconImg }
  ];
  if (child) fields.push({ name: 'note', label: '子卡片备注', value: card?.note });
  else fields.push({ name: 'type', advanced: true, label: '卡片类型', value: card?.type || (folder ? 'expandable' : 'simple'), options: [['simple', '普通链接'], ['desc-clickable', '描述链接'], ['expandable', '展开子卡片']] }, { name: 'descUrl', advanced: true, label: '描述链接 URL', value: card?.descUrl });
  if (!child) fields.splice(2, 0, { name: 'sectionKey', label: '保存到分组', value: s.key, options: state.sections.filter(section => section.kind === 'card').map(section => [section.key, section.label + (section.private ? ' · Private' : '')]) });
  dialog(child ? (card ? '编辑子卡片' : '添加子卡片') : card ? '编辑书签' : '新建书签', fields, values => {
    const target = child ? s : state.sections.find(section => section.key === values.sectionKey && section.kind === 'card'); delete values.sectionKey;
    if (!target) throw new Error('分组已变化，请重新选择');
    if (target !== s && !privateWarning(s, target)) return false;
    validateCard(values, card, state.configUrl);
    if (card && Object.hasOwn(card, 'content') && !Object.hasOwn(card, 'title')) { values.content = values.title; delete values.title; }
    if (card) { Object.assign(card, values); if (target !== s) { s.cards.splice(s.cards.indexOf(card), 1); target.cards.push(card); } } else {
      s = target;
      const created = { id: 'card_' + crypto.randomUUID(), ...values };
      if (parent) { parent.type = 'expandable'; parent.subCards ||= []; parent.subCards.push(created); }
      else { s.cards.push(created); state.selected = s.key; state.scope = 'group'; clearSearch(); }
    }
  }, true, child ? '父卡片：' + (parent.title || parent.content || '未命名') + ' · ' + s.label : '先应用到当前页面草稿，再保存到云端。');
}
function moveCard(from, card, parent = null) {
  const destinations = [];
  for (const section of state.sections.filter(s => s.kind === 'card')) {
    for (const target of [null, ...section.cards.filter(isFolder)]) {
      const to = { section, parent: target };
      if (canMove(from, card, parent, to)) destinations.push({ ...to, label: `${section.label} / ${target ? target.title || target.content || '文件夹' : '顶层'}${section.private ? ' · Private' : ' · 公开'}` });
    }
  }
  dialog('移动书签', [{ name: 'target', label: '目标位置', options: destinations.map((d, i) => [String(i), d.label]) }], values => {
    const to = destinations[Number(values.target)];
    if (!to || !moveItem(state.sections, from, card, parent, to)) return false;
    state.selected = to.section.key; state.scope = 'group';
  });
}
function deleteCard(section, card, parent = null) {
  const items = parent ? parent.subCards : section.cards;
  if (isFolder(card) && card.subCards?.length) {
    const options = [['delete', '删除文件夹及全部内容']];
    if (card.subCards.every(isLeaf)) options.unshift(['extract', '将子书签移出到当前分组']);
    dialog('删除文件夹', [{ name: 'target', label: `包含 ${card.subCards.length} 个子书签`, options }], values => {
      if (!confirm('确认删除文件夹？保存后才会生效。')) return false;
      const index = items.indexOf(card);
      const children = values.target === 'extract' ? card.subCards.map(child => { if (child.type === 'compact') child.type = 'simple'; return child; }) : [];
      items.splice(index, 1, ...children);
    });
  } else if (confirm('删除此书签？保存后才会生效。')) { items.splice(items.indexOf(card), 1); changed(); }
}
return { editGroup, deleteGroup, editCard, moveCard, deleteCard };
}
