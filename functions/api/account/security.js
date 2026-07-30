import { jsonResponse, requireAuth } from '../../_shared/auth.js';
import { readCredentialState, recoveryEnabled, revokeAllSessions } from '../../_shared/account-security.js';

const CLEAR_AUTH_COOKIE = 'auth=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict';

export async function onRequestGet({ request, env }) {
    const denied = await requireAuth(request, env);
    if (denied) return denied;
    const state = await readCredentialState(env);
    return jsonResponse({
        ok: true,
        passwordSource: state.customPassword ? 'custom' : 'environment',
        changedAt: state.changedAt,
        recoveryConfigured: recoveryEnabled(env)
    });
}

export async function onRequestPost({ request, env }) {
    const denied = await requireAuth(request, env);
    if (denied) return denied;
    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }
    if (!body || body.action !== 'revoke-sessions') {
        return jsonResponse({ ok: false, error: '不支持的账户安全操作' }, 400);
    }
    await revokeAllSessions(env);
    return jsonResponse({ ok: true, sessionsRevoked: true }, 200, { 'Set-Cookie': CLEAR_AUTH_COOKIE });
}
