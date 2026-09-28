// Shared field renderer; values remain in DOM until explicitly applied to a page's draft.
import { element as el } from './view-utils.js';
export function createEditor({ editable, changed, beforeOpen = () => {} }) {
  const $ = id => document.getElementById(id);
  let commit = null, baseline = '';
  const values = () => Object.fromEntries([...$('fields').querySelectorAll('input,textarea,select')].map(input => [input.name, input.type === 'checkbox' ? input.checked : input.value]));
  const pending = () => $('editor').open;
  function reset() { $('editor').close(); $('fields').replaceChildren(); commit = null; baseline = ''; }
  function close() {
    if (JSON.stringify(values()) !== baseline && !confirm('有尚未应用的输入，放弃并关闭？')) return;
    reset();
  }
  function dialog(title, fields, apply, drawer = false, context = '') {
    if (!editable()) return;
    beforeOpen(); $('fields').replaceChildren(); $('editorError').textContent = '';
    $('editTitle').textContent = title; $('editorContext').textContent = context || '先应用到当前页面草稿，再保存到云端。';
    const advanced = el('details', null, 'advanced-fields'); advanced.append(el('summary', '更多设置 · 图标与卡片类型'));
    for (const field of fields) {
      const label = el('label', field.label), input = el(field.options ? 'select' : field.multiline ? 'textarea' : 'input'); input.name = field.name;
      if (field.options) for (const [value, text] of field.options) { const option = el('option', text); option.value = value; input.append(option); }
      else if (!field.multiline) input.type = field.checkbox ? 'checkbox' : 'text';
      if (field.checkbox) input.checked = field.value === true; else input.value = field.value ?? field.options?.[0]?.[0] ?? '';
      input.required = !!field.required; label.append(input); (field.advanced ? advanced : $('fields')).append(label);
    }
    if (advanced.children.length > 1) $('fields').append(advanced);
    commit = apply; baseline = JSON.stringify(values()); $('editor').showModal();
  }
  $('editForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!editable()) { $('editorError').textContent = '当前只读，请重新登录并核对云端版本；输入已保留。'; return; }
    try { if (commit && commit(values()) !== false) { reset(); changed(); } }
    catch (error) { $('editorError').textContent = error.message; }
  });
  $('cancelEdit').addEventListener('click', close);
  $('editor').addEventListener('cancel', event => { event.preventDefault(); close(); });
  $('editor').addEventListener('click', event => { if (event.target === $('editor')) { const r = $('editor').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } });
  return { dialog, pending, reset, close };
}
