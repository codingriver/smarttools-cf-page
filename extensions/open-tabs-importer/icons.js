// Local, decorative SVGs only. User-provided SVG/HTML is never inserted here.
const paths = {
  edit: ['M14 4l6 6', 'M3 21l5-1L21 7a2 2 0 0 0-4-4L4 16z'],
  search: ['M21 21l-5-5', 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15'],
  plus: ['M12 5v14', 'M5 12h14'], close: ['M6 6l12 12', 'M18 6L6 18'],
  library: ['M4 4h4v16H4z', 'M11 4h4v16h-4z', 'M18 4l3 15'],
  folder: ['M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z'],
  lock: ['M6 11h12v10H6z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  layers: ['M12 3l10 5-10 5L2 8z', 'M2 12l10 5 10-5', 'M2 16l10 5 10-5'],
  hidden: ['M3 3l18 18', 'M10 5c5-1 9 3 12 7l-3 4', 'M6 6c-2 1-4 3-6 6 3 5 7 8 12 7l3-1'],
  settings: ['M4 6h16', 'M4 12h16', 'M4 18h16', 'M8 3v6', 'M16 9v6', 'M10 15v6'],
  globe: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M3 12h18', 'M12 3c5 5 5 13 0 18-5-5-5-13 0-18'],
  external: ['M14 3h7v7', 'M21 3L10 14', 'M10 3H4v17h17v-6'],
  refresh: ['M20 7a9 9 0 0 0-15-2L3 8', 'M3 3v5h5', 'M4 17a9 9 0 0 0 15 2l2-3', 'M21 21v-5h-5'],
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'], more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  shield: ['M12 3l8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6z', 'M8 12l3 3 5-6'],
  cloud: ['M7 18H5a4 4 0 0 1-1-8 8 8 0 0 1 15-1 5 5 0 0 1 0 10h-2', 'M12 21V12', 'M9 15l3-3 3 3'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'], bookmark: ['M6 3h12v18l-6-4-6 4z']
};
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.65'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true'); svg.classList.add('ui-icon');
  for (const d of paths[name] || paths.bookmark) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}
export function mountIcons() { for (const el of document.querySelectorAll('[data-icon]')) el.replaceChildren(icon(el.dataset.icon)); }
