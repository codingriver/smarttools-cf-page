// 单管理员鉴权工具。带下划线前缀的目录不会成为 Pages 路由。

import { readCredentialState } from './account-security.js';

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

function encodePayload(payload) {
    return bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
}

function decodePayload(value) {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

async function importHmacKey(secret, usages) {
    return crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        usages
    );
}

export function getSecret(env) {
    const secret = env && env.AUTH_SECRET;
    return typeof secret === 'string' && secret.length >= 16 ? secret : null;
}

export async function createToken(username, secret, days = 7, sessionVersion = 0) {
    if (!secret) throw new Error('AUTH_SECRET 未配置');
    const payload = encodePayload({
        u: username,
        role: 'admin',
        sv: Number.isSafeInteger(sessionVersion) ? sessionVersion : 0,
        exp: Date.now() + days * 86400 * 1000
    });
    const key = await importHmacKey(secret, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyToken(token, secret) {
    if (!token || !secret) return null;
    const parts = String(token).split('.');
    if (parts.length !== 2) return null;
    try {
        const key = await importHmacKey(secret, ['verify']);
        const valid = await crypto.subtle.verify(
            'HMAC',
            key,
            base64UrlToBytes(parts[1]),
            encoder.encode(parts[0])
        );
        if (!valid) return null;
        const payload = decodePayload(parts[0]);
        if (!payload || payload.role !== 'admin' || !payload.u) return null;
        if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
        return payload;
    } catch {
        return null;
    }
}

export function getCookieToken(request) {
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/(?:^|;\s*)auth=([^;]+)/);
    return match ? match[1] : null;
}

export async function getPayload(request, env) {
    const secret = getSecret(env);
    const adminUser = env && env.ADMIN_USER;
    if (!secret || !adminUser) return null;
    const payload = await verifyToken(getCookieToken(request), secret);
    if (!payload || payload.u !== adminUser) return null;
    const credentials = await readCredentialState(env);
    return payload.sv === credentials.sessionVersion ? payload : null;
}

export async function requireAuth(request, env) {
    if (!getSecret(env)) {
        return jsonResponse({ ok: false, error: '服务端未配置 AUTH_SECRET' }, 500);
    }
    if (!env || !env.ADMIN_USER || !env.ADMIN_PASS) {
        return jsonResponse({ ok: false, error: '服务端未配置管理员凭据' }, 500);
    }
    return await getPayload(request, env)
        ? null
        : jsonResponse({ ok: false, error: '未登录或会话已过期' }, 401);
}

export const requireAdmin = requireAuth;

export async function getUsername(request, env) {
    const payload = await getPayload(request, env);
    return payload ? payload.u : null;
}

export async function getUserId(request, env) {
    return getUsername(request, env);
}

export async function getRole(request, env) {
    return await getPayload(request, env) ? 'admin' : null;
}

export function jsonResponse(obj, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: {
            'Content-Type': 'application/json;charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            ...extraHeaders
        }
    });
}
