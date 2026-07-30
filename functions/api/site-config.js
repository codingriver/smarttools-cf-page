// GET  /api/site-config  → 读取网站基础配置（标题/页眉/页脚/后台设置），公开访问
// POST /api/site-config  → 保存网站配置（需登录）
//
// 配置结构：
//   { title: string, header: string, footer: string, subCardLayout: 'classic' | 'directory', autoBackupEnabled: boolean, backupRetention: number, deleteConfirmEnabled: boolean }
// 空字符串表示使用页面默认内容。

import { requireAuth, jsonResponse } from '../_shared/auth.js';
import {
    ADMIN_SITE_CONFIG_KEY,
    normalizeSiteConfig,
    readSiteConfig
} from '../_shared/site-config.js';
import { invalidatePublicDataCache } from '../_shared/public-data-cache.js';

export async function onRequestGet({ request, env }) {
    return jsonResponse({ ok: true, ...await readSiteConfig(env) });
}

export async function onRequestPost({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }

    // 允许部分更新；未提交字段沿用现有配置。
    const current = await readSiteConfig(env);
    const config = normalizeSiteConfig({ ...current, ...body }, current);

    await env.FAV_KV.put(ADMIN_SITE_CONFIG_KEY, JSON.stringify(config));
    await invalidatePublicDataCache(request);
    return jsonResponse({ ok: true, ...config });
}
