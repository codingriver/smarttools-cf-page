import { authReply, credentials, createSessionToken, safeEqual, sessionCookie } from '../../../_shared/auth-v2.js';
const PREFIX = 'lockout:v2:';
const MAX_ATTEMPTS = 5;
const WINDOW = 600;
function clientIP(request) {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf.trim();
  const forwarded = request.headers.get('X-Forwarded-For');
  return forwarded ? forwarded.split(',')[0].trim() : 'unknown';
}
async function locked(kv, key) {
  if (!kv) return null;
  try {
    const item = await kv.getWithMetadata(key, { type: 'text' });
    if (!item?.value) return null;
    return { count: Number.parseInt(item.value, 10) || 0, expireAt: Number(item.metadata?.expireAt) || 0 };
  } catch { return null; } // KV-based throttling is best effort.
}
async function failed(kv, key, previous) {
  if (!kv) return;
  const now = Math.floor(Date.now() / 1000);
  const expireAt = previous?.expireAt > now ? previous.expireAt : now + WINDOW;
  try { await kv.put(key, String((previous?.count || 0) + 1), { expirationTtl: Math.max(1, expireAt - now), metadata: { expireAt } }); } catch {}
}
export async function onRequestPost({ request, env }) {
  const config = credentials(env);
  if (!config) return authReply({ ok: false, code: 'AUTH_NOT_CONFIGURED', error: '账户或 AUTH_SECRET 配置无效' }, 503);
  const key = PREFIX + clientIP(request);
  const current = await locked(env.FAV_KV, key);
  if (current?.count >= MAX_ATTEMPTS && current.expireAt > Math.floor(Date.now() / 1000))
    return authReply({ ok: false, error: '登录失败次数过多，请稍后再试' }, 429, { 'Retry-After': String(current.expireAt - Math.floor(Date.now() / 1000)) });
  let body;
  try { body = await request.json(); } catch { return authReply({ ok: false, error: '请求格式错误' }, 400); }
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string' ||
      !body.username || !body.password || body.username.length > 256 || body.password.length > 512)
    return authReply({ ok: false, error: '用户名或密码格式错误' }, 400);
  if (!safeEqual(body.username, config.user) || !safeEqual(body.password, config.password)) {
    await failed(env.FAV_KV, key, current);
    return authReply({ ok: false, error: '用户名或密码错误' }, 401);
  }
  if (env.FAV_KV) try { await env.FAV_KV.delete(key); } catch {}
  return authReply({ ok: true, username: config.user, role: 'admin' }, 200, { 'Set-Cookie': sessionCookie(await createSessionToken(env)) });
}
