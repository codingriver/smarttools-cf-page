export const PUBLIC_DATA_CACHE_VERSION = 'v1';

export function publicDataCacheKey(request) {
    const url = new URL('/api/data', request.url);
    url.searchParams.set('__smarttools_public_cache', PUBLIC_DATA_CACHE_VERSION);
    return new Request(url.toString(), { method: 'GET' });
}

export async function invalidatePublicDataCache(request) {
    if (typeof caches === 'undefined' || !caches.default) return false;
    try {
        return await caches.default.delete(publicDataCacheKey(request));
    } catch {
        return false;
    }
}
