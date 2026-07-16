import { getPayload, getSecret, jsonResponse } from '../_shared/auth.js';

export async function onRequestGet({ request, env }) {
    const payload = await getPayload(request, env);
    return jsonResponse({
        ok: true,
        loggedIn: !!payload,
        username: payload ? payload.u : null,
        uid: payload ? payload.u : null,
        role: payload ? 'admin' : null,
        hasKV: !!env.FAV_KV,
        hasAdmin: !!(env.ADMIN_USER && env.ADMIN_PASS),
        hasAuthSecret: !!getSecret(env)
    });
}
