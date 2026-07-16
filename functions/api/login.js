import { createToken, getSecret, jsonResponse } from '../_shared/auth.js';

const LOCKOUT_PREFIX = 'lockout:';
const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 600;
const encoder = new TextEncoder();

function getClientIP(request) {
    const cf = request.headers.get('CF-Connecting-IP');
    if (cf) return cf.trim();
    const forwarded = request.headers.get('X-Forwarded-For');
    return forwarded ? forwarded.split(',')[0].trim() : 'unknown';
}

async function constantTimeEqual(left, right) {
    const [a, b] = await Promise.all([
        crypto.subtle.digest('SHA-256', encoder.encode(String(left || ''))),
        crypto.subtle.digest('SHA-256', encoder.encode(String(right || '')))
    ]);
    const aa = new Uint8Array(a);
    const bb = new Uint8Array(b);
    let diff = 0;
    for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
    return diff === 0;
}

async function readLockout(env, ip) {
    if (!env.FAV_KV) return null;
    try {
        const result = await env.FAV_KV.getWithMetadata(LOCKOUT_PREFIX + ip, { type: 'text' });
        if (!result || result.value == null) return null;
        return {
            count: Number.parseInt(result.value, 10) || 0,
            expireAt: Number(result.metadata && result.metadata.expireAt) || 0
        };
    } catch {
        return null;
    }
}

async function recordFailure(env, ip) {
    if (!env.FAV_KV) return;
    const current = await readLockout(env, ip);
    const now = Math.floor(Date.now() / 1000);
    const expireAt = current && current.expireAt > now ? current.expireAt : now + WINDOW_SECONDS;
    await env.FAV_KV.put(LOCKOUT_PREFIX + ip, String((current ? current.count : 0) + 1), {
        expirationTtl: Math.max(1, expireAt - now),
        metadata: { expireAt }
    });
}

async function clearFailure(env, ip) {
    if (env.FAV_KV) await env.FAV_KV.delete(LOCKOUT_PREFIX + ip);
}

export async function onRequestPost({ request, env }) {
    const ip = getClientIP(request);
    const lockout = await readLockout(env, ip);
    if (lockout && lockout.count >= MAX_ATTEMPTS) {
        const now = Math.floor(Date.now() / 1000);
        return jsonResponse({ ok: false, error: '登录失败次数过多，请稍后再试' }, 429, {
            'Retry-After': String(Math.max(1, lockout.expireAt - now))
        });
    }

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }

    const username = String(body && body.username || '');
    const password = String(body && body.password || '');
    if (!username || !password) return jsonResponse({ ok: false, error: '用户名或密码为空' }, 400);
    if (!env.ADMIN_USER || !env.ADMIN_PASS) {
        return jsonResponse({ ok: false, error: '服务端未配置 ADMIN_USER / ADMIN_PASS' }, 500);
    }
    const secret = getSecret(env);
    if (!secret) return jsonResponse({ ok: false, error: 'AUTH_SECRET 未配置或长度不足 16 位' }, 500);

    const [userOk, passOk] = await Promise.all([
        constantTimeEqual(username, env.ADMIN_USER),
        constantTimeEqual(password, env.ADMIN_PASS)
    ]);
    if (!userOk || !passOk) {
        try { await recordFailure(env, ip); } catch {}
        return jsonResponse({ ok: false, error: '用户名或密码错误' }, 401);
    }

    try { await clearFailure(env, ip); } catch {}
    const token = await createToken(env.ADMIN_USER, secret);
    return jsonResponse({ ok: true, username: env.ADMIN_USER, role: 'admin' }, 200, {
        'Set-Cookie': `auth=${token}; Path=/; Max-Age=${7 * 86400}; HttpOnly; Secure; SameSite=Strict`
    });
}
