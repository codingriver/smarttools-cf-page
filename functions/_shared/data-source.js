import { discardLegacyEncryptedSections, readSplitSnapshot } from './data-split.js';
const DATA_KEY = 'admin:data_js';
const SOURCE_KEY = 'admin:data_source';
const EMPTY_STUB = 'var sections = [];\n';

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

export async function readData(request, env, allowForcedSource = true) {
    const url = new URL(request.url);
    const forced = allowForcedSource ? url.searchParams.get('source') : null;
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
        rawContent: content || EMPTY_STUB,
        storedContent: kvContent,
        configured: selected,
        actualSource
    };
}

