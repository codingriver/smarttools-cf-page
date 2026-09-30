import { safeUrl } from './model.js';
export function element(tag, text, className) {
  const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el;
}
export function bookmarkMark(card, base, className = 'tile-mark') {
  const name = String(card.title || card.content || '未命名');
  const text = card.icon && !/[<>]/.test(String(card.icon)) && !/^https?:/.test(String(card.icon)) ? String(card.icon) : name;
  const mark = element('span', [...text].slice(0, 2).join('').toUpperCase(), className);
  mark.setAttribute('aria-hidden', 'true');
  const url = safeUrl(card.iconImg, base);
  if (url && /^https?:/.test(url)) {
    const image = element('img'); image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
    // Keep the local text fallback until the image really loads (also when offline).
    image.hidden = true;
    image.addEventListener('load', () => { mark.replaceChildren(image); image.hidden = false; });
    image.addEventListener('error', () => image.remove()); image.src = url; mark.append(image);
  }
  return mark;
}
export function bookmarkLink(label, url, base, className) {
  const href = safeUrl(url, base); const el = element(href ? 'a' : 'span', label, className);
  if (href) { el.href = href; el.target = '_blank'; el.rel = 'noopener noreferrer'; }
  return el;
}
export function cacheLabel(savedAt) { return savedAt ? '本机缓存 · 最后同步 ' + new Date(savedAt).toLocaleString() : '尚无完整本机缓存'; }
