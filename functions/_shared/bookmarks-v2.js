import { requireV2Auth, authReply } from './auth-v2.js';
import { validateDocument, businessContent, MAX_BYTES } from '../../extensions/open-tabs-importer/bookmark-document.js';
export const CURRENT_KEY = 'admin:bookmarks:v2:current';
export const reply = (body, status = 200) => authReply(body, status);
export async function authorize(request, env) {
  const auth = await requireV2Auth(request, env);
  if (auth) { const response = new Response(auth.body, auth); response.headers.set('Cache-Control', 'private, no-store'); return response; }
  if (!env.FAV_KV) return reply({ ok: false, code: 'KV_UNAVAILABLE', error: '未绑定 KV，不能读取或保存书签' }, 503);
  return null;
}
export async function readCurrent(env) {
  const raw = await env.FAV_KV.get(CURRENT_KEY);
  if (!raw) throw Object.assign(new Error('书签库尚未初始化，请先导入 v2 初始化文档'), { status: 409, code: 'BOOKMARKS_UNINITIALIZED' });
  const value = JSON.parse(raw);
  try { validateDocument(value?.document); } catch { throw new Error('Invalid stored document'); }
  if (typeof value.etag !== 'string' || !/^"[^"\r\n]+"$/.test(value.etag)) throw new Error('Invalid stored revision');
  return value;
}
export function envelope(value, extra = {}) {
  return { ok: true, ...extra, document: value.document, meta: { etag: value.etag, source: 'kv', view: 'admin' } };
}
export async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES + 65536) throw Object.assign(new Error('请求过大'), { status: 413, code: 'DOCUMENT_TOO_LARGE' });
  const reader = request.body?.getReader(); if (!reader) throw Object.assign(new Error('缺少 JSON'), { status: 400 });
  const chunks = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > MAX_BYTES + 65536) { await reader.cancel(); throw Object.assign(new Error('请求过大'), { status: 413, code: 'DOCUMENT_TOO_LARGE' }); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw Object.assign(new Error('请求不是有效 JSON'), { status: 400, code: 'INVALID_JSON' }); }
}
export async function handleBookmarks({ request, env }, metaOnly = false) {
  let attempted = false;
  try {
    const failure = await authorize(request, env); if (failure) return failure;
    let current = await readCurrent(env);
    if (request.method === 'GET') return reply(metaOnly ? { ok: true, schemaVersion: 2, updatedAt: current.document.updatedAt, etag: current.etag } : envelope(current));
    if (request.method !== 'PUT' || metaOnly) return reply({ ok: false, error: '不支持的方法' }, 405);
    const body = await readBody(request);
    current = await readCurrent(env); // Check after the upload, not before a potentially slow body stream.
    if (!body || typeof body.baseEtag !== 'string' || !body.baseEtag) return reply({ ok: false, code: 'PRECONDITION_REQUIRED', error: '保存必须提供 baseEtag' }, 428);
    if (body.baseEtag !== current.etag) return reply({ ok: false, code: 'SAVE_CONFLICT', error: '云端版本已变化；保留草稿并核对后再保存' }, 409);
    // Client clocks cannot modify cloud time, including malformed or fabricated input timestamps.
    const document = validateDocument({ ...body.document, updatedAt: current.document.updatedAt });
    if (businessContent(current.document) === businessContent(document)) return reply(envelope(current, { unchanged: true }));
    if (Date.now() - current.document.updatedAt < 1100) return reply({ ok: false, code: 'WRITE_RATE_LIMIT', error: '提交过于频繁，请稍后核对再保存' }, 429);
    document.updatedAt = Math.max(Date.now(), current.document.updatedAt + 1);
    const next = { document, etag: '"' + crypto.randomUUID() + '"' };
    if ((await readCurrent(env)).etag !== current.etag) return reply({ ok: false, code: 'SAVE_CONFLICT', error: '云端版本已变化；草稿保留' }, 409);
    attempted = true;
    await env.FAV_KV.put(CURRENT_KEY, JSON.stringify(next));
    return reply(envelope(next, { unchanged: false }));
  } catch (error) {
    const status = error.status || 503;
    return reply({ ok: false, code: error.code || 'BOOKMARKS_STORAGE_ERROR', error: error.status ? error.message : '书签存储暂时不可用，请保留草稿并核对云端', ...(attempted ? { outcomeUnknown: true } : {}) }, status);
  }
}
