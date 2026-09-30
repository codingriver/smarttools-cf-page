import { authReply } from '../_shared/auth-v2.js';
export function onRequest() { return authReply({ ok: false, error: 'Not Found' }, 404); }
