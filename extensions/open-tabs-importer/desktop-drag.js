import { canMove, moveItem, reorderBefore } from './draft-actions.js';
// HTML drag events are accepted only for an active internal draft object. No external payload is trusted.
export function bindDesktopDrag({ state, editable, searching, resolve, changed, onMoved, report }) {
  let source = null, highlight = null, target = null, suppressUntil = 0;
  const clean = () => { document.querySelectorAll('.drop-before,.drop-after,.drop-inside,.drop-invalid').forEach(el => el.classList.remove('drop-before', 'drop-after', 'drop-inside', 'drop-invalid')); highlight = null; target = null; };
  function cancel() { clean(); document.querySelectorAll('.drag-source').forEach(el => el.classList.remove('drag-source')); document.body.classList.remove('dragging'); source = null; suppressUntil = Date.now() + 250; }
  document.addEventListener('dragstart', event => {
    const node = event.target.closest('[data-ref]'); const ref = resolve(node);
    if (!ref || !editable() || searching() || node.draggable !== true) { event.preventDefault(); return; }
    source = ref; node.classList.add('drag-source'); document.body.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', 'Qiye internal draft');
  });
  document.addEventListener('dragover', event => {
    if (!source) return;
    event.preventDefault(); clean(); event.dataTransfer.dropEffect = 'none';
    if (!editable() || searching()) { event.dataTransfer.dropEffect = 'none'; return; }
    const node = event.target.closest('[data-ref],[data-drop]');
    const ref = resolve(node); if (!node || !ref) return;
    const rect = node.getBoundingClientRect(); let style = 'drop-inside';
    if (source.group) {
      if (!ref.group || source.section === ref.section) return;
      const after = event.clientY > rect.top + rect.height / 2;
      target = { group: true, before: after ? state.sections[state.sections.indexOf(ref.section) + 1] || null : ref.section };
      style = after ? 'drop-after' : 'drop-before';
    } else {
      let to = { section: ref.section, parent: ref.parent || null }, before = null;
      if (ref.card) {
        const center = event.clientX > rect.left + rect.width * .25 && event.clientX < rect.right - rect.width * .25;
        if (ref.card.type === 'expandable' && center && ref.card !== source.card) to.parent = ref.card;
        else {
          const items = ref.parent ? ref.parent.subCards : ref.section.cards;
          const after = event.clientX > rect.left + rect.width / 2;
          before = after ? items[items.indexOf(ref.card) + 1] || null : ref.card;
          style = after ? 'drop-after' : 'drop-before';
        }
      }
      if (!canMove(source.section, source.card, source.parent, to)) { style = 'drop-invalid'; event.dataTransfer.dropEffect = 'none'; }
      else target = { to, before };
    }
    highlight = node; highlight.classList.add(style); event.dataTransfer.dropEffect = target ? 'move' : 'none';
    const scrollable = event.target.closest('#groups,.folder-backdrop');
    const bounds = scrollable?.getBoundingClientRect() || { top: 0, bottom: innerHeight };
    const dy = event.clientY < bounds.top + 45 ? -18 : event.clientY > bounds.bottom - 45 ? 18 : 0;
    if (dy) { if (scrollable) scrollable.scrollTop += dy; else window.scrollBy(0, dy); }
  });
  document.addEventListener('drop', event => {
    if (!source) return;
    event.preventDefault(); const from = source, dest = target; cancel();
    if (!dest || !editable() || searching()) return;
    try {
      const didMove = dest.group ? reorderBefore(state.sections, from.section, dest.before) : moveItem(state.sections, from.section, from.card, from.parent, dest.to, dest.before);
      if (didMove) { if (!dest.group) onMoved(dest.to); changed(); }
    } catch (error) { report(error.message, true); }
  });
  document.addEventListener('dragend', cancel);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && source) { event.preventDefault(); event.stopImmediatePropagation(); cancel(); } }, true);
  document.addEventListener('click', event => { if (Date.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  return { cancel };
}
