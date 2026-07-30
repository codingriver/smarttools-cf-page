// 公开图标同域代理：把外部书签 favicon 转为同源请求，消除第三方防盗链 / 跨域 403，
// 并让图标可被 Service Worker 缓存（离线可用）。失败时回退 200 透明图，避免浏览器控制台报错。
// 安全边界（AGENTS.md）：仅允许 http(s)；拦截私有 / 回环地址的主机字面量；超时与大小限制。

const ICON_PROXY_TIMEOUT_MS = 8000;
const ICON_PROXY_MAX_BYTES = 5 * 1024 * 1024;

function isPrivateHostname(hostname) {
  const h = String(hostname || '').toLowerCase().trim();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0') return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2], c = +m[3], d = +m[4];
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

function transparentImageResponse() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('u');
  if (!target || !/^https?:\/\//i.test(target)) return transparentImageResponse();

  let parsed;
  try {
    parsed = new URL(target);
  } catch (_) {
    return transparentImageResponse();
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return transparentImageResponse();
  if (isPrivateHostname(parsed.hostname)) return transparentImageResponse();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ICON_PROXY_TIMEOUT_MS);
  try {
    const upstream = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'SmartTools-IconProxy/1.0', 'Accept': 'image/*,*/*' }
    });
    const ct = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !/^image\//i.test(ct)) return transparentImageResponse();

    // 流式读取并限制大小，避免超大响应。
    const reader = upstream.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > ICON_PROXY_MAX_BYTES) {
        reader.cancel();
        return transparentImageResponse();
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (_) {
    return transparentImageResponse();
  } finally {
    clearTimeout(timer);
  }
}
