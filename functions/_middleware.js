import { authReply } from './_shared/auth-v2.js';

const routes = new Map([
  ['/api/v2/auth/login', 'POST'],
  ['/api/v2/auth/session', 'GET'],
  ['/api/v2/auth/logout', 'POST'],
  ['/api/v2/bookmarks', 'GET, PUT'],
  ['/api/v2/bookmarks/meta', 'GET']
]);
export async function onRequest(context) {
  const path = new URL(context.request.url).pathname;
  const methods = routes.get(path);
  if (!methods) return authReply({ ok: false, error: 'Not Found' }, 404);
  if (!methods.split(', ').includes(context.request.method))
    return authReply({ ok: false, error: 'Method Not Allowed' }, 405, { Allow: methods });
  return context.next();
}
