import { readData } from '../_shared/data-source.js';
import { structuredSections } from '../_shared/structured-data.js';
import { getCookieToken, getPayload, jsonResponse } from '../_shared/auth.js';
import { ensureDataMeta, makeDataEtag, sha256HexText } from '../_shared/data-meta.js';
import { readSiteConfig } from '../_shared/site-config.js';
import {
    stripPrivateSections
} from '../_shared/data-split.js';
import { publicDataCacheKey } from '../_shared/public-data-cache.js';

const PUBLIC_DATA_CACHE_CONTROL = 'public, max-age=31536000, s-maxage=86400, stale-while-revalidate=31536000';

function serializeForScript(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function publicCacheKey(request) {
    return publicDataCacheKey(request);
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const format = url.searchParams.get('format');
    const forcedSource = url.searchParams.get('source');
    const hasAuthCookie = !!getCookieToken(request);
    const cacheEligible = !hasAuthCookie && !format && !forcedSource && typeof caches !== 'undefined';
    const cache = cacheEligible ? caches.default : null;
    const cacheKey = cacheEligible ? publicCacheKey(request) : null;

    if (cache && cacheKey) {
        const cached = await cache.match(cacheKey);
        if (cached) {
            const headers = new Headers(cached.headers);
            headers.set('X-SmartTools-Cache', 'HIT');
            return new Response(cached.body, { status: cached.status, headers });
        }
    }

    const payloadPromise = hasAuthCookie ? getPayload(request, env) : Promise.resolve(null);
    const [payload, loaded, siteConfig] = await Promise.all([
        payloadPromise,
        readData(request, env),
        readSiteConfig(env)
    ]);
    const isAdmin = !!payload;
    const fullContent = loaded.content;
    const responseContent = isAdmin ? fullContent : stripPrivateSections(fullContent);

    let fullMeta;
    if (loaded.actualSource === 'kv' && env.FAV_KV) {
        fullMeta = await ensureDataMeta(env, 'admin', fullContent);
    } else {
        const hash = await sha256HexText(fullContent);
        fullMeta = {
            version: hash,
            hash,
            etag: makeDataEtag(hash, 'full'),
            size: fullContent.length
        };
    }

    const responseHash = isAdmin ? fullMeta.hash : await sha256HexText(responseContent);
    const responseEtag = isAdmin
        ? (fullMeta.etag || makeDataEtag(responseHash, 'full'))
        : makeDataEtag(responseHash, 'public');

    if (format === 'json' || format === 'structured') {
        let sections;
        if (format === 'structured') {
            try { sections = structuredSections(loaded.rawContent, isAdmin); }
            catch { return jsonResponse({ ok: false, error: '数据无法安全转换为结构化格式，请在网站后台检查数据', code: 'UNSUPPORTED_DATA' }, 422); }
        }
        return jsonResponse({
            ok: true,
            ...(format === 'structured' ? { sections, hasKV: !!env.FAV_KV } : { content: responseContent }),
            source: loaded.actualSource,
            configured: loaded.configured,
            namespace: 'admin',
            dataVersion: fullMeta.version,
            dataEtag: responseEtag,
            dataHash: responseHash,
            privateFiltered: !isAdmin,
            siteConfig
        }, 200, { 'Cache-Control': isAdmin ? 'private, no-store' : 'no-store', 'ETag': responseEtag });
    }

    const headers = {
        'Content-Type': 'application/javascript;charset=utf-8',
        'Cache-Control': isAdmin
            ? 'private, no-store'
            : PUBLIC_DATA_CACHE_CONTROL,
        'ETag': responseEtag,
        'X-Content-Type-Options': 'nosniff',
        'X-Data-Version': fullMeta.version || '',
        'X-Data-ETag': responseEtag,
        'X-Data-Source': loaded.actualSource,
        'X-Data-Namespace': 'admin',
        'X-Private-Filtered': isAdmin ? '0' : '1'
    };

    const ifNoneMatch = request.headers.get('If-None-Match');
    if (ifNoneMatch && ifNoneMatch.split(',').map(value => value.trim()).includes(responseEtag)) {
        return new Response(null, { status: 304, headers });
    }

    const body =
        `window.__siteConfig = ${serializeForScript(siteConfig)};\n` +
        `window.__viewerInfo = ${serializeForScript({ isAdminView: isAdmin })};\n` +
        responseContent;

    if (cache && cacheKey && context && typeof context.waitUntil === 'function') {
        const cachedResponse = new Response(body, { headers });
        context.waitUntil(cache.put(cacheKey, cachedResponse));
        const missHeaders = new Headers(headers);
        missHeaders.set('X-SmartTools-Cache', 'MISS');
        return new Response(body, { headers: missHeaders });
    }

    return new Response(body, { headers });
}
