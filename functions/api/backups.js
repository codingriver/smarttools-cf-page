import { requireAuth, jsonResponse } from '../_shared/auth.js';
import {
    discardLegacyEncryptedSections,
    readSplitSnapshot,
    writeSplitFromContent
} from '../_shared/data-split.js';

const NS = 'admin';
const DATA_KEY = 'admin:data_js';
const BACKUP_PREFIX = 'admin:backup:';
const SITE_CONFIG_KEY = 'admin:site_config';
const DEFAULT_RETENTION = 30;

export async function onRequestGet({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);
    const name = new URL(request.url).searchParams.get('name');
    if (name) {
        const content = await env.FAV_KV.get(BACKUP_PREFIX + name);
        if (content == null) return jsonResponse({ ok: false, error: '备份不存在' }, 404);
        return jsonResponse({ ok: true, content: discardLegacyEncryptedSections(content), namespace: NS });
    }
    const list = await env.FAV_KV.list({ prefix: BACKUP_PREFIX });
    const backups = list.keys
        .map(item => ({ name: item.name.slice(BACKUP_PREFIX.length) }))
        .sort((a, b) => b.name.localeCompare(a.name));
    return jsonResponse({ ok: true, backups, namespace: NS });
}

export async function onRequestPost({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const name = url.searchParams.get('name');

    if (action === 'create') {
        const current = discardLegacyEncryptedSections(
            await readSplitSnapshot(env, NS) || await env.FAV_KV.get(DATA_KEY) || ''
        );
        if (!current.trim()) return jsonResponse({ ok: false, error: '当前没有可备份的数据' }, 404);
        const backup = timestamp();
        await env.FAV_KV.put(BACKUP_PREFIX + backup, current);
        const retention = await getRetention(env);
        const prunedBackups = retention > 0 ? await pruneBackups(env.FAV_KV, retention) : 0;
        return jsonResponse({ ok: true, backup, prunedBackups, namespace: NS });
    }

    if (action !== 'restore' || !name) return jsonResponse({ ok: false, error: '未知 action 或缺少 name' }, 400);
    const stored = await env.FAV_KV.get(BACKUP_PREFIX + name);
    if (stored == null) return jsonResponse({ ok: false, error: '备份不存在' }, 404);
    const content = discardLegacyEncryptedSections(stored);
    const current = discardLegacyEncryptedSections(
        await readSplitSnapshot(env, NS) || await env.FAV_KV.get(DATA_KEY) || ''
    );
    if (current.trim()) await env.FAV_KV.put(BACKUP_PREFIX + timestamp(), current);
    await Promise.all([
        env.FAV_KV.put(DATA_KEY, content),
        env.FAV_KV.put('admin:data_source', 'kv'),
        writeSplitFromContent(env, NS, content)
    ]);
    return jsonResponse({ ok: true, namespace: NS });
}

export async function onRequestDelete({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);
    const name = new URL(request.url).searchParams.get('name');
    if (!name) return jsonResponse({ ok: false, error: '缺少 name' }, 400);
    await env.FAV_KV.delete(BACKUP_PREFIX + name);
    return jsonResponse({ ok: true, namespace: NS });
}

function timestamp() {
    const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const pad = value => String(value).padStart(2, '0');
    return date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) + '_'
        + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds());
}

async function getRetention(env) {
    try {
        const raw = await env.FAV_KV.get(SITE_CONFIG_KEY);
        const value = raw ? JSON.parse(raw).backupRetention : DEFAULT_RETENTION;
        const number = Number(value);
        if (!Number.isFinite(number)) return DEFAULT_RETENTION;
        const rounded = Math.floor(number);
        return rounded === 0 ? 0 : Math.max(1, Math.min(500, rounded));
    } catch {
        return DEFAULT_RETENTION;
    }
}

async function pruneBackups(kv, limit) {
    const list = await kv.list({ prefix: BACKUP_PREFIX });
    if (list.keys.length <= limit) return 0;
    const remove = list.keys.sort((a, b) => a.name.localeCompare(b.name)).slice(0, list.keys.length - limit);
    await Promise.all(remove.map(item => kv.delete(item.name)));
    return remove.length;
}
