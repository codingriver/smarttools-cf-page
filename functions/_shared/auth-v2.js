// v2 single-admin authentication. No KV credential record or legacy session dependencies.
const encoder = new TextEncoder();
const DEFAULT_USER = 'admin';
const DEFAULT_PASSWORD = 'codingriver2026';
const COOKIE = 'auth';
const DAYS = 7;

export function authReply(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', ...headers
  } });
}
export function credentials(env) {
  const user = env && Object.hasOwn(env, 'USER') ? env.USER : DEFAULT_USER;
  const password = env && Object.hasOwn(env, 'PASSWORD') ? env.PASSWORD : DEFAULT_PASSWORD;
  const secret = env?.AUTH_SECRET;
  if (typeof user !== 'string' || !user || typeof password !== 'string' || !password || typeof secret !== 'string' || secret.length < 16) return null;
  return { user, password, secret, usesDefaultPassword: !Object.hasOwn(env, 'PASSWORD') };
}
function base64url(bytes) {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode64(value) {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function hmac(secret, usages) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}
async function signingKey(config) {
  // Derive a purpose-separated key from an unambiguous length-delimited JSON tuple.
  // Neither the password nor any standalone password verifier enters the cookie.
  const key = await hmac(config.secret, ['sign']);
  const material = encoder.encode(JSON.stringify(['smarttools-auth-v2', config.user, config.password]));
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, material)));
}
export async function createSessionToken(env, now = Date.now()) {
  const config = credentials(env); if (!config) throw new Error('账户配置不可用');
  const payload = base64url(encoder.encode(JSON.stringify({ v: 2, u: config.user, role: 'admin', exp: now + DAYS * 86400000 })));
  const key = await hmac(await signingKey(config), ['sign']);
  const signature = base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
  return `${payload}.${signature}`;
}
export async function session(request, env) {
  const config = credentials(env); if (!config) return null;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/(?:^|;\s*)auth=([^;]+)/)?.[1];
  if (!token || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [encoded, signature] = token.split('.');
  try {
    const key = await hmac(await signingKey(config), ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, decode64(signature), encoder.encode(encoded))) return null;
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode64(encoded)));
    if (payload?.v !== 2 || payload.u !== config.user || payload.role !== 'admin' ||
        !Number.isSafeInteger(payload.exp) || payload.exp < Date.now()) return null;
    return { username: config.user, usesDefaultPassword: config.usesDefaultPassword };
  } catch { return null; }
}
export async function requireV2Auth(request, env) {
  if (!credentials(env)) return authReply({ ok: false, code: 'AUTH_NOT_CONFIGURED', error: '账户或 AUTH_SECRET 配置无效' }, 503);
  return await session(request, env) ? null : authReply({ ok: false, error: '未登录或会话已过期' }, 401);
}
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // Fixed-time comparison over a bounded digest, including unequal-length input.
  // Caller must reject unreasonably large user inputs before comparing.
  const left = encoder.encode(a), right = encoder.encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}
export const expiredCookie = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
export const sessionCookie = token => `${COOKIE}=${token}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`;
