import { authReply, credentials, session } from '../../../_shared/auth-v2.js';
export async function onRequestGet({ request, env }) {
  const current = await session(request, env);
  return authReply({ ok: true, loggedIn: !!current,
    username: current?.username || null, role: current ? 'admin' : null,
    hasKV: !!env.FAV_KV, hasAuthSecret: typeof env.AUTH_SECRET === 'string' && env.AUTH_SECRET.length >= 16,
    configured: !!credentials(env), ...(current ? { usesDefaultPassword: current.usesDefaultPassword } : {}) });
}
