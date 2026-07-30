import { jsonResponse, requireAuth } from '../../_shared/auth.js';
import {
    readCredentialState,
    setAdminPassword,
    validateNewPassword,
    verifyAdminPassword
} from '../../_shared/account-security.js';

const CLEAR_AUTH_COOKIE = 'auth=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict';

export async function onRequestPost({ request, env }) {
    const denied = await requireAuth(request, env);
    if (denied) return denied;

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }

    const currentPassword = String(body && body.currentPassword || '');
    const newPassword = String(body && body.newPassword || '');
    if (!currentPassword || !newPassword) {
        return jsonResponse({ ok: false, error: '当前密码和新密码不能为空' }, 400);
    }
    const passwordError = validateNewPassword(newPassword);
    if (passwordError) return jsonResponse({ ok: false, error: passwordError }, 400);
    if (currentPassword === newPassword) {
        return jsonResponse({ ok: false, error: '新密码不能与当前密码相同' }, 400);
    }

    const state = await readCredentialState(env);
    if (!await verifyAdminPassword(currentPassword, env, state)) {
        return jsonResponse({ ok: false, error: '当前密码错误' }, 401);
    }

    const updated = await setAdminPassword(env, newPassword, state);
    return jsonResponse({
        ok: true,
        changedAt: updated.changedAt,
        sessionsRevoked: true
    }, 200, { 'Set-Cookie': CLEAR_AUTH_COOKIE });
}
