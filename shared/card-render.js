/* ================================================================
 * shared/card-render.js
 * ────────────────────────────────────────────────────────────────
 * 卡片图标渲染的单一来源（主页 fav-page.js 与后台 config-app.js 共用）。
 * - safeIconUrl(u):外部 http(s) 图标统一改写为同域 /api/icon 代理，
 *   杜绝第三方防盗链 / 跨域 403，并让 Service Worker 可缓存（离线可用）。
 * - renderIconInto(el, item):把卡片图标渲染进给定容器（emoji / 图片 / 内联 SVG）。
 *
 * 以经典脚本(IIFE)方式暴露全局 window.safeIconUrl / window.renderIconInto，
 * 这样无需 ES module 即可被两页直接复用，且不改变既有全局作用域约定。
 * ================================================================ */
(function (global) {
    'use strict';

    function safeIconUrl(u) {
        var s = String(u == null ? '' : u).trim();
        if (!s) return '';
        if (/^https?:\/\//i.test(s)) {
            try { return '/api/icon?u=' + encodeURIComponent(s); } catch (_) { return ''; }
        }
        if (/^(?:\/|data:image\/[a-zA-Z+.-]+;)/i.test(s)) return s;
        return '';
    }

    /* SVG 安全过滤：去掉 <script>/<foreignObject>、内联事件、javascript: 协议，
     * 与 note-modal.js 的 sanitizeSVG 保持一致。 */
    function sanitizeSVG(raw) {
        if (!raw || typeof raw !== 'string') return '';
        return raw
            .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
            .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
            .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
            .replace(/\bon\w+\s*=\s*[^\s>\/]+/gi, '')
            .replace(/(?:href|xlink:href)\s*=\s*["']\s*javascript:/gi, 'data-removed="javascript-uri"');
    }

    function renderIconInto(el, item) {
        if (!el) return;
        el.innerHTML = '';
        if (item && item.iconImg) {
            var url = safeIconUrl(item.iconImg);
            if (!url) { el.textContent = '🖼'; return; }
            var img = document.createElement('img');
            img.loading = 'lazy';
            img.decoding = 'async';
            img.src = url;
            img.onerror = function () { el.innerHTML = '🖼'; };
            el.appendChild(img);
        } else if (item && item.icon) {
            if (String(item.icon).trim().charAt(0) === '<') {
                el.innerHTML = (typeof global.sanitizeSVG === 'function')
                    ? global.sanitizeSVG(item.icon)
                    : sanitizeSVG(item.icon);
            } else {
                el.textContent = item.icon;
            }
        } else {
            el.textContent = '❓';
        }
    }

    global.safeIconUrl = safeIconUrl;
    global.renderIconInto = renderIconInto;
})(window);
