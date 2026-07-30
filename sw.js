/*
 * SmartTools Service Worker
 * 目标：公开主页「立即显示 + 最长本地（≥3 年）+ 后台更新 + 离线」。
 *
 * 安全边界（必须遵守 AGENTS.md）：
 *  - 只缓存「公开 / 匿名」资源；绝不缓存带 private / no-store 的响应，
 *    也不缓存任何 /api/* 与管理页（config.html）。
 *  - 管理端登录态、Private 数据不会进入 Cache Storage。
 */

const VERSION = 'smarttools-v1';
const CONTENT_CACHE = VERSION + '-content';
const META_CACHE = VERSION + '-meta';
// 最长本地保留：3 年。超过则 prune（浏览器配额压力下会更早，但上限由我们控制）。
const MAX_AGE_MS = 3 * 365 * 24 * 60 * 60 * 1000;

// 允许缓存的同源路径（全部为公开资源）。
function isCacheableSameOrigin(url) {
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  if (p === '/' || p === '/index.html') return true;
  if (p.startsWith('/shared/') || p.startsWith('/extensions/')) return true;
  if (p.startsWith('/icons/')) return true; // 构建期下载到本地的公开图标
  return false;
}

// 同域图标代理（/api/icon）：公开图片，可缓存（离线可用）。绝不等于其它 /api/* 管理接口。
function isCacheableIconProxy(url) {
  return url.origin === self.location.origin && url.pathname === '/api/icon';
}

// 跨源图标图片：仅当请求目标是 image 时才缓存（图标以 <img> 加载，destination==='image'）。
function isCacheableCrossOriginImage(event) {
  if (event.request.method !== 'GET') return false;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin) return false;
  if (event.request.destination !== 'image') return false;
  return true;
}

// 同源响应是否可缓存：拒绝 private / no-store（保护管理端与 Private 数据）。
function isPublicResponse(response) {
  if (!response) return false;
  const cc = (response.headers.get('cache-control') || '').toLowerCase();
  if (/\b(private|no-store)\b/.test(cc)) return false;
  return true;
}

function etagEqual(a, b) {
  const ea = a && a.headers.get('ETag');
  const eb = b && b.headers.get('ETag');
  if (!ea || !eb) return false;
  return ea === eb;
}

// ---- 缓存写入与元数据 ----

async function writeMeta(url) {
  try {
    const meta = await caches.open(META_CACHE);
    await meta.put(
      url,
      new Response(JSON.stringify({ at: Date.now() }), {
        headers: { 'content-type': 'application/json' }
      })
    );
  } catch (_) {
    /* 元数据写入失败不致命 */
  }
}

// ---- 策略 ----

// 首页 HTML：cache-first + 后台更新（stale-while-revalidate）。
// 后台用 cache:'reload' 绕过 HTTP 缓存，确保部署后立即拉到新 HTML。
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CONTENT_CACHE);
  const cached = await cache.match(req);
  const network = fetch(req, { cache: 'reload' })
    .then(async (res) => {
      if (res && res.ok && isPublicResponse(res)) {
        await cache.put(req, res.clone());
        await writeMeta(req.url);
      }
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

// 指纹化静态资源与跨源图标：命中即返回，未命中才联网（不每次后台重拉）。
// 注意：跨源 <img> 返回 opaque 响应（ok=false），按 res.type !== 'error' 判定可缓存。
async function cacheFirstOnly(req) {
  const cache = await caches.open(CONTENT_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.type !== 'error') {
      await cache.put(req, res.clone());
      await writeMeta(req.url);
    }
    return res;
  } catch (e) {
    return cached || Response.error();
  }
}

// 非白名单导航（如 config.html）离线时回退到已缓存的主页。
async function passthroughOrHomeFallback(req) {
  try {
    return await fetch(req);
  } catch (e) {
    const cache = await caches.open(CONTENT_CACHE);
    return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error();
  }
}

// ---- 清理：删除旧版本缓存 + 超过 3 年的条目 ----

async function pruneOld() {
  const meta = await caches.open(META_CACHE);
  const content = await caches.open(CONTENT_CACHE);
  const metaKeys = await meta.keys();
  const now = Date.now();
  const validUrls = new Set();
  await Promise.all(
    metaKeys.map(async (req) => {
      validUrls.add(req.url);
      const res = await meta.match(req);
      let at = 0;
      if (res) {
        try {
          at = (await res.json()).at || 0;
        } catch (_) {}
      }
      if (now - at > MAX_AGE_MS) {
        await meta.delete(req);
        await content.delete(req);
      }
    })
  );
  // 删除没有任何元数据的孤立内容条目（极少数情况下产生）。
  const contentKeys = await content.keys();
  await Promise.all(
    contentKeys.map(async (req) => {
      if (!validUrls.has(req.url)) {
        await content.delete(req);
      }
    })
  );
}

// ---- 事件 ----

self.addEventListener('install', (event) => {
  // 跳过等待，新 SW 立即激活。
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n !== CONTENT_CACHE && n !== META_CACHE)
          .map((n) => caches.delete(n))
      );
      await pruneOld();
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST（登录/保存等）一律直连，不缓存

  const url = new URL(req.url);

  // 首页导航：公开 HTML → SWR
  if (req.mode === 'navigate') {
    if (url.origin === self.location.origin && (url.pathname === '/' || url.pathname === '/index.html')) {
      event.respondWith(staleWhileRevalidate(req));
    } else {
      // 其它页面（含 admin config.html）直连；离线回退主页
      event.respondWith(passthroughOrHomeFallback(req));
    }
    return;
  }

  // 同源公开静态资源（含 /icons/* 本地图标）
  if (isCacheableSameOrigin(url)) {
    event.respondWith(cacheFirstOnly(req));
    return;
  }

  // 同域图标代理（公开图片，可缓存；区别于其它 /api/* 管理接口）
  if (isCacheableIconProxy(url)) {
    event.respondWith(cacheFirstOnly(req));
    return;
  }

  // 跨源图标图片
  if (isCacheableCrossOriginImage(event)) {
    event.respondWith(cacheFirstOnly(req));
    return;
  }

  // 其余（/api/* 管理接口等）直连，绝不缓存
});
