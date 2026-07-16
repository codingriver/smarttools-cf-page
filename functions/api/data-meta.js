import { getPayload, jsonResponse } from '../_shared/auth.js';
import { makeDataEtag, sha256HexText } from '../_shared/data-meta.js';
import { discardLegacyEncryptedSections, readSplitSnapshot, stripPrivateSections } from '../_shared/data-split.js';

const DATA_KEY = 'admin:data_js';
const SOURCE_KEY = 'admin:data_source';
const EMPTY_STUB = `/* data.js 尚未初始化 */\nvar sections = [];\n`;

async function readStaticData(request, env) {
    try {
        const response = await env.ASSETS.fetch(new URL('/data.js', request.url).toString());
        return response.ok ? await response.text() : null;
    } catch {
        return null;
    }
}

export async function onRequestGet({ request, env }) {
    const payload = await getPayload(request, env);
    const isAdmin = !!payload;
    let source = 'static';
    let content = null;

    if (env.FAV_KV) {
        const [saved, data, snapshot] = await Promise.all([
            env.FAV_KV.get(SOURCE_KEY),
            env.FAV_KV.get(DATA_KEY),
            readSplitSnapshot(env, 'admin')
        ]);
        if (saved === 'kv' || saved === 'static') source = saved;
        if (source === 'kv') content = snapshot || data || null;
    }
    if (!content) {
        content = await readStaticData(request, env);
        source = content ? (source === 'kv' ? 'static-fallback' : 'static') : 'empty';
    }

    const fullContent = discardLegacyEncryptedSections(content || EMPTY_STUB);
    const responseContent = isAdmin ? fullContent : stripPrivateSections(fullContent);
    const hash = await sha256HexText(responseContent);
    const etag = makeDataEtag(hash, isAdmin ? 'full' : 'public');

    return jsonResponse({
        ok: true,
        loggedIn: isAdmin,
        namespace: 'admin',
        source,
        dataVersion: hash,
        dataEtag: etag,
        dataHash: hash,
        privateFiltered: !isAdmin
    }, 200, {
        'Cache-Control': isAdmin
            ? 'private, no-store'
            : 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
        'ETag': etag,
        'X-Data-Version': hash,
        'X-Data-ETag': etag
    });
}
