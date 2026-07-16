export const ADMIN_SITE_CONFIG_KEY = 'admin:site_config';

export const DEFAULT_SITE_CONFIG = Object.freeze({
    title: '',
    header: '',
    footer: '',
    autoBackupEnabled: false,
    backupRetention: 30,
    deleteConfirmEnabled: true
});

export function normalizeBackupRetention(value, fallback = DEFAULT_SITE_CONFIG.backupRetention) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const rounded = Math.floor(n);
    if (rounded === 0) return 0;
    return Math.max(1, Math.min(500, rounded));
}

export function normalizeSiteConfig(value = {}, fallback = DEFAULT_SITE_CONFIG) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        title: source.title != null ? String(source.title) : String(fallback.title || ''),
        header: source.header != null ? String(source.header) : String(fallback.header || ''),
        footer: source.footer != null ? String(source.footer) : String(fallback.footer || ''),
        autoBackupEnabled: source.autoBackupEnabled != null
            ? source.autoBackupEnabled === true
            : fallback.autoBackupEnabled === true,
        backupRetention: source.backupRetention != null
            ? normalizeBackupRetention(source.backupRetention, fallback.backupRetention)
            : normalizeBackupRetention(fallback.backupRetention),
        deleteConfirmEnabled: source.deleteConfirmEnabled != null
            ? source.deleteConfirmEnabled !== false
            : fallback.deleteConfirmEnabled !== false
    };
}

export async function readSiteConfig(env) {
    if (!env.FAV_KV) return { ...DEFAULT_SITE_CONFIG };
    try {
        const saved = await env.FAV_KV.get(ADMIN_SITE_CONFIG_KEY);
        return saved
            ? normalizeSiteConfig(JSON.parse(saved))
            : { ...DEFAULT_SITE_CONFIG };
    } catch {
        return { ...DEFAULT_SITE_CONFIG };
    }
}
