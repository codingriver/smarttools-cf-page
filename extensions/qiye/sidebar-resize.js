// Local UI preference only: no bookmark data, RPC, authentication or cloud writes.
const KEY = 'desktopSidebarWidth';
const DEFAULT = 180, MIN = 56, MAX = 280;
const validWidth = value => typeof value === 'number' && Number.isFinite(value) && value >= MIN && value <= MAX ? Math.round(value) : DEFAULT;

export function bindSidebarResize({ sidebar, separator, report, storage = chrome.storage.local, changes = chrome.storage.onChanged }) {
  let preferred = DEFAULT, saved = DEFAULT, revision = 0, localIntent = 0, active = null, timer = null;
  let writes = Promise.resolve(), pendingWrites = 0, suppressClick = false, suppressTimer;
  const mobile = () => innerWidth <= 600;
  const maximum = () => Math.min(MAX, Math.floor(innerWidth * 35 / 100));
  const clamp = value => Math.max(MIN, Math.min(maximum(), Math.round(value)));
  function render() {
    const width = clamp(preferred);
    document.documentElement.style.setProperty('--sidebar-width', width + 'px');
    sidebar.dataset.wide = String(mobile() || width >= 128);
    separator.tabIndex = mobile() ? -1 : 0;
    separator.setAttribute('aria-valuemax', String(maximum()));
    separator.setAttribute('aria-valuenow', String(width));
    separator.setAttribute('aria-valuetext', width + ' 像素');
  }
  function persist() {
    clearTimeout(timer); timer = null;
    const width = preferred;
    pendingWrites++;
    // Serialize this page's commits, so an older async write cannot overwrite a newer one.
    writes = writes.then(async () => {
      const startingRevision = revision;
      let committed = false;
      try { await storage.set({ [KEY]: width }); committed = true; }
      catch { report('宽度未能记住；当前页面仍使用调整后的宽度', true); }
      finally {
        pendingWrites--;
        // A newer storage event may arrive before this write's promise settles.
        // Reconcile it when idle, without rolling back a failed local preference.
        if (committed && !pendingWrites && !active && !timer && revision !== startingRevision) { preferred = saved; render(); }
      }
    });
  }
  function suppressPostDragClick() {
    suppressClick = true;
    clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => { suppressClick = false; }, 250);
  }
  function finish(commit) {
    if (!active) return;
    const gesture = active; active = null;
    document.body.classList.remove('resizing-sidebar');
    if (separator.hasPointerCapture(gesture.id)) separator.releasePointerCapture(gesture.id);
    if (commit && gesture.moved) persist();
    else preferred = revision !== gesture.revision ? saved : gesture.before;
    render();
    if (gesture.moved) suppressPostDragClick();
  }
  separator.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || mobile() || active || document.body.classList.contains('dragging')) return;
    if (timer) persist();
    event.preventDefault(); separator.focus(); localIntent++;
    active = { id: event.pointerId, x: event.clientX, width: clamp(preferred), before: preferred, revision, moved: false };
    separator.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-sidebar');
  });
  separator.addEventListener('pointermove', event => {
    if (!active || event.pointerId !== active.id) return;
    if (event.clientX !== active.x) active.moved = true;
    preferred = clamp(active.width + event.clientX - active.x); render();
  });
  separator.addEventListener('pointerup', event => { if (active?.id === event.pointerId) finish(true); });
  separator.addEventListener('pointercancel', event => { if (active?.id === event.pointerId) finish(false); });
  separator.addEventListener('lostpointercapture', () => finish(false));
  separator.addEventListener('dblclick', event => {
    if (mobile() || document.body.classList.contains('dragging')) return;
    event.preventDefault(); localIntent++; preferred = DEFAULT; render(); persist();
  });
  separator.addEventListener('keydown', event => {
    if (mobile() || active || document.body.classList.contains('dragging') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); localIntent++;
    preferred = event.key === 'Home' ? MIN : event.key === 'End' ? maximum() : clamp(clamp(preferred) + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 24 : 8));
    render(); clearTimeout(timer); timer = setTimeout(persist, 200);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active) { event.preventDefault(); event.stopImmediatePropagation(); finish(false); }
  }, true);
  document.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('blur', () => { finish(false); if (timer) persist(); });
  window.addEventListener('pagehide', () => { finish(false); if (timer) persist(); });
  window.addEventListener('resize', () => { finish(false); render(); });
  changes.addListener((entries, area) => {
    if (area !== 'local' || !Object.hasOwn(entries, KEY)) return;
    saved = validWidth(entries[KEY].newValue); revision++;
    if (!active && !timer && !pendingWrites) { preferred = saved; render(); }
  });
  render();
  const ready = storage.get(KEY).then(result => {
    if (revision || localIntent || active || timer || pendingWrites) return;
    preferred = saved = validWidth(result[KEY]); render();
  }).catch(() => report('无法读取侧栏宽度偏好，暂用默认宽度', true));
  return { ready };
}
