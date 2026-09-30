import { authReply, expiredCookie } from '../../../_shared/auth-v2.js';
export async function onRequestPost() {
  return authReply({ ok: true }, 200, { 'Set-Cookie': expiredCookie });
}
