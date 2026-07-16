import { jsonResponse } from '../_shared/auth.js';

export async function onRequest() {
    return jsonResponse({ ok: false, error: 'API 不存在' }, 404);
}
