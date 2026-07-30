export const ADMIN_CREDENTIALS_KEY = 'admin:credentials';
export const ADMIN_RECOVERY_USED_PREFIX = 'admin:recovery_used:';
export const PASSWORD_ALGORITHM = 'PBKDF2-SHA-256';
export const PASSWORD_ITERATIONS = 310000;

const encoder = new TextEncoder();

function bytesToBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value) {
    let normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4) normalized += '=';
    const binary = atob(normalized);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function sha256Bytes(value) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(String(value || ''))));
}

export async function constantTimeEqual(left, right) {
    const [a, b] = await Promise.all([sha256Bytes(left), sha256Bytes(right)]);
    let diff = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
    return diff === 0;
}

function constantTimeEqualBytes(a, b) {
    let diff = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
    return diff === 0;
}

async function derivePasswordHash(password, salt, iterations = PASSWORD_ITERATIONS) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt,
        iterations
    }, key, 256);
    return new Uint8Array(bits);
}

function normalizeCredentialRecord(value) {
    const source = value && typeof value === 'object' ? value : {};
    const hasOwn = key => Object.prototype.hasOwnProperty.call(source, key);
    if (hasOwn('sessionVersion') &&
        (!Number.isSafeInteger(source.sessionVersion) || source.sessionVersion < 0)) {
        throw new Error('管理员凭据会话版本无效');
    }
    const sessionVersion = hasOwn('sessionVersion') ? source.sessionVersion : 0;
    const hasPassword = source.algorithm === PASSWORD_ALGORITHM &&
        Number.isSafeInteger(source.iterations) && source.iterations >= 100000 &&
        typeof source.salt === 'string' && !!source.salt &&
        typeof source.hash === 'string' && !!source.hash;
    const hasPartialPassword = ['algorithm', 'iterations', 'salt', 'hash'].some(hasOwn);
    if (hasPartialPassword && !hasPassword) throw new Error('管理员密码哈希记录无效');
    return {
        algorithm: hasPassword ? source.algorithm : null,
        iterations: hasPassword ? source.iterations : PASSWORD_ITERATIONS,
        salt: hasPassword ? source.salt : null,
        hash: hasPassword ? source.hash : null,
        sessionVersion,
        changedAt: typeof source.changedAt === 'string' ? source.changedAt : null,
        customPassword: hasPassword
    };
}

export async function readCredentialState(env) {
    if (!env || !env.FAV_KV) return normalizeCredentialRecord(null);
    const saved = await env.FAV_KV.get(ADMIN_CREDENTIALS_KEY);
    if (!saved) return normalizeCredentialRecord(null);
    try {
        return normalizeCredentialRecord(JSON.parse(saved));
    } catch {
        throw new Error('管理员凭据记录损坏，请使用恢复流程重设密码');
    }
}

export function validateNewPassword(password) {
    const value = String(password || '');
    if (value.length < 10) return '新密码至少需要 10 个字符';
    if (value.length > 128) return '新密码不能超过 128 个字符';
    const normalized = value.toLowerCase();
    const weak = ['1234567890', 'password123', 'admin12345', 'qwerty12345', '1111111111'];
    if (weak.includes(normalized)) return '新密码过于常见，请更换更安全的密码';
    return '';
}

export async function verifyAdminPassword(password, env, state) {
    const current = state || await readCredentialState(env);
    if (current.customPassword) {
        try {
            const actual = await derivePasswordHash(
                String(password || ''),
                base64UrlToBytes(current.salt),
                current.iterations
            );
            return constantTimeEqualBytes(actual, base64UrlToBytes(current.hash));
        } catch {
            return false;
        }
    }
    return constantTimeEqual(password, env && env.ADMIN_PASS);
}

export async function setAdminPassword(env, password, currentState) {
    if (!env || !env.FAV_KV) throw new Error('未绑定 KV，无法保存后台密码');
    const state = currentState || await readCredentialState(env);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derivePasswordHash(String(password), salt);
    const record = {
        algorithm: PASSWORD_ALGORITHM,
        iterations: PASSWORD_ITERATIONS,
        salt: bytesToBase64Url(salt),
        hash: bytesToBase64Url(hash),
        sessionVersion: state.sessionVersion + 1,
        changedAt: new Date().toISOString()
    };
    await env.FAV_KV.put(ADMIN_CREDENTIALS_KEY, JSON.stringify(record));
    return normalizeCredentialRecord(record);
}

export async function revokeAllSessions(env, currentState) {
    if (!env || !env.FAV_KV) throw new Error('未绑定 KV，无法撤销会话');
    const state = currentState || await readCredentialState(env);
    const record = {
        ...(state.customPassword ? {
            algorithm: state.algorithm,
            iterations: state.iterations,
            salt: state.salt,
            hash: state.hash,
            changedAt: state.changedAt
        } : {}),
        sessionVersion: state.sessionVersion + 1
    };
    await env.FAV_KV.put(ADMIN_CREDENTIALS_KEY, JSON.stringify(record));
    return normalizeCredentialRecord(record);
}

export function recoveryEnabled(env) {
    const authSecret = env && env.AUTH_SECRET;
    return !!(env && env.PASSWORD_RECOVERY_ENABLED === 'true' &&
        typeof env.PASSWORD_RECOVERY_TOKEN === 'string' && env.PASSWORD_RECOVERY_TOKEN.length >= 32 &&
        typeof authSecret === 'string' && authSecret.length >= 16);
}

export async function recoveryTokenFingerprint(token) {
    return bytesToBase64Url(await sha256Bytes(token));
}

export async function isRecoveryTokenUsed(env, fingerprint) {
    if (!env || !env.FAV_KV) return false;
    return !!await env.FAV_KV.get(ADMIN_RECOVERY_USED_PREFIX + fingerprint);
}

export async function markRecoveryTokenUsed(env, fingerprint) {
    if (!env || !env.FAV_KV) throw new Error('未绑定 KV，无法完成密码恢复');
    await env.FAV_KV.put(ADMIN_RECOVERY_USED_PREFIX + fingerprint, new Date().toISOString());
}
