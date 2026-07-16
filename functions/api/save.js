import { requireAuth, jsonResponse } from '../_shared/auth.js';
import { writeDataMeta } from '../_shared/data-meta.js';
import {
    applySectionDelta,
    discardLegacyEncryptedSections,
    readSplitSnapshot,
    writeSplitFromContent
} from '../_shared/data-split.js';

const NS = 'admin';
const DATA_KEY = 'admin:data_js';
const SOURCE_KEY = 'admin:data_source';
const BACKUP_PREFIX = 'admin:backup:';
const SITE_CONFIG_KEY = 'admin:site_config';
const DEFAULT_BACKUP_RETENTION = 30;

export async function onRequestPost({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV(FAV_KV)' }, 500);

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }

    const saveMode = body && body.mode === 'sections' ? 'sections' : 'full';
    let content = body && body.content;
    if (saveMode === 'full' && (typeof content !== 'string' || !content.trim())) {
        return jsonResponse({ ok: false, error: '内容为空' }, 400);
    }

    const [storedData, snapshot] = await Promise.all([
        env.FAV_KV.get(DATA_KEY),
        readSplitSnapshot(env, NS)
    ]);
    const old = discardLegacyEncryptedSections(snapshot || storedData || '');
    let deltaResult = null;

    if (saveMode === 'sections') {
        if (!old.trim()) {
            return jsonResponse({ ok: false, error: '当前没有可增量更新的数据，请先完整保存一次' }, 409);
        }
        try {
            deltaResult = await applySectionDelta(env, NS, old, body);
            content = deltaResult.content;
        } catch (error) {
            return jsonResponse({
                ok: false,
                error: error && error.message ? error.message : '分类级保存失败'
            }, 400);
        }
    }

    content = discardLegacyEncryptedSections(content);
    if (!content.trim()) return jsonResponse({ ok: false, error: '有效内容为空' }, 400);
    const contentChanged = old !== content;
    const backupSettings = await getBackupSettings(env);
    let backupName = null;
    let prunedBackups = 0;

    if (backupSettings.autoBackupEnabled && old.trim() && contentChanged) {
        backupName = timestamp();
        await env.FAV_KV.put(BACKUP_PREFIX + backupName, old);
        if (backupSettings.backupRetention > 0) {
            prunedBackups = await pruneBackups(env.FAV_KV, BACKUP_PREFIX, backupSettings.backupRetention);
        }
    }

    if (contentChanged) {
        await Promise.all([
            env.FAV_KV.put(DATA_KEY, content),
            env.FAV_KV.put(SOURCE_KEY, 'kv'),
            writeSplitFromContent(env, NS, content)
        ]);
    } else if (await env.FAV_KV.get(SOURCE_KEY) !== 'kv') {
        await env.FAV_KV.put(SOURCE_KEY, 'kv');
    }

    const meta = contentChanged ? await writeDataMeta(env, NS, content) : null;
    return jsonResponse({
        ok: true,
        backup: backupName,
        prunedBackups,
        unchanged: !contentChanged,
        namespace: NS,
        saveMode,
        sectionDelta: deltaResult ? {
            changedCount: deltaResult.changedCount,
            deletedCount: deltaResult.deletedCount,
            sectionCount: deltaResult.sectionCount
        } : null,
        dataVersion: meta && meta.version,
        dataEtag: meta && meta.etag
    });
}

function timestamp() {
    const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const pad = value => String(value).padStart(2, '0');
    return date.getUTCFullYear()
        + pad(date.getUTCMonth() + 1)
        + pad(date.getUTCDate()) + '_'
        + pad(date.getUTCHours())
        + pad(date.getUTCMinutes())
        + pad(date.getUTCSeconds());
}

async function getBackupSettings(env) {
    try {
        const raw = await env.FAV_KV.get(SITE_CONFIG_KEY);
        const config = raw ? JSON.parse(raw) : {};
        return {
            autoBackupEnabled: config.autoBackupEnabled === true,
            backupRetention: normalizeRetention(config.backupRetention)
        };
    } catch {
        return { autoBackupEnabled: false, backupRetention: DEFAULT_BACKUP_RETENTION };
    }
}

function normalizeRetention(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_BACKUP_RETENTION;
    const rounded = Math.floor(number);
    return rounded === 0 ? 0 : Math.max(1, Math.min(500, rounded));
}

async function pruneBackups(kv, prefix, limit) {
    const list = await kv.list({ prefix });
    if (list.keys.length <= limit) return 0;
    const remove = list.keys
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, list.keys.length - limit);
    await Promise.all(remove.map(item => kv.delete(item.name)));
    return remove.length;
}
