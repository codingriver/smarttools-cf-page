import { getCookieToken, getPayload, jsonResponse } from '../_shared/auth.js';
import { ensureDataMeta, makeDataEtag, sha256HexText } from '../_shared/data-meta.js';
import { readSiteConfig } from '../_shared/site-config.js';
import {
    discardLegacyEncryptedSections,
    readSplitSnapshot,
    stripPrivateSections
} from '../_shared/data-split.js';
import { publicDataCacheKey } from '../_shared/public-data-cache.js';

const DATA_KEY = 'admin:data_js';
const SOURCE_KEY = 'admin:data_source';
const EMPTY_STUB = `/* data.js 尚未初始化 */\nvar sections = [];\n`;

function serializeForScript(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function publicCacheKey(request) {
    return publicDataCacheKey(request);
}

async function readStaticData(request, env) {
    const url = new URL('/data.js', request.url);
    try {
        if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
            const response = await env.ASSETS.fetch(url.toString());
            if (response.ok) return await response.text();
        }
    } catch {}
    return null;
}

async function readData(request, env) {
    const url = new URL(request.url);
    const forced = url.searchParams.get('source');
    let configured = 'static';
    let kvContent = null;

    if (env.FAV_KV) {
        const [saved, data, snapshot] = await Promise.all([
            env.FAV_KV.get(SOURCE_KEY),
            env.FAV_KV.get(DATA_KEY),
            readSplitSnapshot(env, 'admin')
        ]);
        if (saved === 'kv' || saved === 'static') configured = saved;
        kvContent = snapshot || data || null;
    }

    const selected = forced === 'kv' || forced === 'static' ? forced : configured;
    let content = selected === 'kv' ? kvContent : null;
    let actualSource = selected;

    if (!content) {
        content = await readStaticData(request, env);
        actualSource = content ? (selected === 'kv' ? 'static-fallback' : 'static') : 'empty';
    }
    return {
        content: discardLegacyEncryptedSections(content || EMPTY_STUB),
        configured: selected,
        actualSource
    };
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

    if (format === 'json') {
        return jsonResponse({
            ok: true,
            content: responseContent,
            source: loaded.actualSource,
            configured: loaded.configured,
            namespace: 'admin',
            dataVersion: fullMeta.version,
            dataEtag: responseEtag,
            dataHash: responseHash,
            privateFiltered: !isAdmin,
            siteConfig
        });
    }

    const headers = {
        'Content-Type': 'application/javascript;charset=utf-8',
        'Cache-Control': isAdmin
            ? 'private, no-store'
            : 'public, max-age=86400, s-maxage=3600, stale-while-revalidate=86400',
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
