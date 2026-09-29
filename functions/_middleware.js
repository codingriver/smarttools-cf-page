import { bookmarksMode } from './_shared/bookmarks-v2.js';
import { jsonResponse } from './_shared/auth.js';
const retired = new Set(['/api/data','/api/data-meta','/api/save','/api/comment','/api/source','/api/site-config','/api/backups','/api/fetch-page-title']);
const oldPages = new Set(['/','/index','/index.html','/config','/config.html','/c']);
export async function onRequest(context) {
  const mode = bookmarksMode(context.env);
  if (mode === 'legacy') return context.next();
  const url = new URL(context.request.url), path = url.pathname.replace(/\/+$/, '') || '/';
  if (retired.has(path) || path === '/data.js') return jsonResponse({ ok: false, code: mode === 'v2' ? 'LEGACY_BOOKMARKS_RETIRED' : 'BOOKMARKS_MAINTENANCE', error: mode === 'v2' ? '旧书签功能已停用，请使用新版栖页扩展' : '书签正在维护，暂不可读写' }, mode === 'v2' ? 410 : 503, { 'Cache-Control': 'private, no-store' });
  if (path === '/sw.js' || oldPages.has(path)) {
    const response = await context.env.ASSETS.fetch(new URL(path === '/sw.js' ? '/retired-sw.js' : '/retired.html', url).href);
    const result = new Response(response.body, response); result.headers.set('Cache-Control', 'no-store'); return result;
  }
  return context.next();
}
