// Retirement worker: remove only this project's caches; never cache bookmarks or auth.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('smarttools-')) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => new Response('书签网站已停用。请使用栖页扩展的本机缓存。', { headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Cache-Control': 'no-store' } })));
});
