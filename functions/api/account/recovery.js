import { jsonResponse } from '../../_shared/auth.js';
import {
    constantTimeEqual,
    isRecoveryTokenUsed,
    markRecoveryTokenUsed,
    readCredentialState,
    recoveryEnabled,
    recoveryTokenFingerprint,
    setAdminPassword,
    validateNewPassword
} from '../../_shared/account-security.js';

const LOCKOUT_PREFIX = 'recovery-lockout:';
const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 900;
const CLEAR_AUTH_COOKIE = 'auth=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict';

function getClientIP(request) {
    const cf = request.headers.get('CF-Connecting-IP');
    if (cf) return cf.trim();
    const forwarded = request.headers.get('X-Forwarded-For');
    return forwarded ? forwarded.split(',')[0].trim() : 'unknown';
}

async function readAttempts(env, ip) {
    if (!env.FAV_KV) return 0;
    try { return Number.parseInt(await env.FAV_KV.get(LOCKOUT_PREFIX + ip), 10) || 0; }
    catch { return 0; }
}

async function recordFailure(env, ip, count) {
    if (!env.FAV_KV) return;
    await env.FAV_KV.put(LOCKOUT_PREFIX + ip, String(count + 1), { expirationTtl: WINDOW_SECONDS });
}

export async function onRequestGet({ env }) {
    return jsonResponse({ ok: true, recoveryEnabled: recoveryEnabled(env) });
}

export async function onRequestPost({ request, env }) {
    if (!recoveryEnabled(env)) return jsonResponse({ ok: false, error: '密码恢复入口未启用' }, 404);
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV，无法恢复密码' }, 500);

    const ip = getClientIP(request);
    const attempts = await readAttempts(env, ip);
    if (attempts >= MAX_ATTEMPTS) {
        return jsonResponse({ ok: false, error: '恢复尝试次数过多，请稍后再试' }, 429, {
            'Retry-After': String(WINDOW_SECONDS)
        });
    }

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }
    const recoveryToken = String(body && body.recoveryToken || '');
    const newPassword = String(body && body.newPassword || '');
    const passwordError = validateNewPassword(newPassword);
    if (!recoveryToken || passwordError) {
        return jsonResponse({ ok: false, error: passwordError || '恢复令牌不能为空' }, 400);
    }

    const fingerprint = await recoveryTokenFingerprint(recoveryToken);
    if (await isRecoveryTokenUsed(env, fingerprint)) {
        return jsonResponse({ ok: false, error: '该恢复令牌已经使用' }, 409);
    }
    if (!await constantTimeEqual(recoveryToken, env.PASSWORD_RECOVERY_TOKEN)) {
        try { await recordFailure(env, ip, attempts); } catch {}
        return jsonResponse({ ok: false, error: '恢复令牌错误' }, 401);
    }

    const state = await readCredentialState(env);
    const updated = await setAdminPassword(env, newPassword, state);
    await markRecoveryTokenUsed(env, fingerprint);
    try { await env.FAV_KV.delete(LOCKOUT_PREFIX + ip); } catch {}
    return jsonResponse({
        ok: true,
        changedAt: updated.changedAt,
        sessionsRevoked: true,
        recoveryTokenConsumed: true
    }, 200, { 'Set-Cookie': CLEAR_AUTH_COOKIE });
}
