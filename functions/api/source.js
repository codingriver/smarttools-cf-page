import { requireAuth, jsonResponse } from '../_shared/auth.js';

const SOURCE_KEY = 'admin:data_source';

export async function onRequestGet({ env }) {
    if (!env.FAV_KV) {
        return jsonResponse({ ok: true, source: 'static', configured: false, namespace: 'admin' });
    }
    const saved = await env.FAV_KV.get(SOURCE_KEY);
    const valid = saved === 'kv' || saved === 'static';
    return jsonResponse({
        ok: true,
        source: valid ? saved : 'static',
        configured: valid,
        namespace: 'admin'
    });
}

export async function onRequestPost({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);
    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }
    if (body.source !== 'kv' && body.source !== 'static') {
        return jsonResponse({ ok: false, error: 'source 必须是 kv 或 static' }, 400);
    }
    await env.FAV_KV.put(SOURCE_KEY, body.source);
    return jsonResponse({ ok: true, source: body.source, namespace: 'admin' });
}
