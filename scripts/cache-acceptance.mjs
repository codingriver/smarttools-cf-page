import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

// A real HTTP server and real service worker: routing/mocking requests in Playwright
// would bypass the HTTP cache behavior that distinguishes F5 from hard reload.
const dist = path.resolve('dist');
const index = (await readFile(path.join(dist, 'index.html'), 'utf8'))
    .replace(/<script data-inline-data="1"[^>]*>[\s\S]*?<\/script>/, '');
const worker = await readFile(path.join(dist, 'sw.js'), 'utf8');
const legacyWorker = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') event.respondWith(
    caches.open('smarttools-v1-content').then(async cache =>
      (await cache.match(event.request)) || fetch(event.request)));
});`;
const cards = Array.from({ length: 8 }, (_, i) => ({
    id: `fixture_${i}`, type: 'simple', title: `Fixture ${i}`, url: 'https://example.com'
}));
cards.push({
    id: 'fixture_folder', type: 'expandable', title: 'Fixture folder', icon: '📁',
    subCards: [{ id: 'fixture_child', type: 'compact', content: 'Fixture child', url: 'https://example.com/child', icon: 'F' }]
});
const data = `window.__siteConfig = {title:'Cache acceptance',subCardLayout:'directory'};
window.__viewerInfo = {isAdminView:false};
var sections = ${JSON.stringify([{ key: 'custom_cache', kind: 'card', label: 'Cache fixture', visible: true, dynamic: true, cards }])};`;
let legacy = true;
let revision = 1;
let homeCacheControl = 'public, no-cache';
let homeRequests = 0;
const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/cache-test') {
        response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Cache setup</title>');
    } else if (pathname === '/sw.js') {
        response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' }).end(legacy ? legacyWorker : worker);
    } else if (pathname === '/' || pathname === '/index.html') {
        homeRequests++;
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': homeCacheControl });
        response.end(index.replace('<head>', `<head><meta name="cache-test-revision" content="${revision}">`));
    } else if (pathname === '/api/data') {
        response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, no-cache', 'X-Private-Filtered': '1', ETag: '"cache-fixture"' }).end(data);
    } else if (pathname === '/shared/cache-test-private.js') {
        response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'private, no-store' }).end('// synthetic private response');
    } else if (pathname.startsWith('/shared/') && !pathname.includes('..')) {
        try {
            const body = await readFile(path.join(dist, pathname));
            response.writeHead(200, {
                'Content-Type': pathname.endsWith('.css') ? 'text/css' : 'application/javascript',
                'Cache-Control': 'public, max-age=31536000, immutable'
            }).end(body);
        } catch (_) { response.writeHead(404).end(); }
    } else { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;

async function verifyLayer(page) {
    await page.locator('#custom_cache-expand-btn').click();
    await page.locator('#custom_cache-collapse-btn').waitFor({ state: 'visible' });
    const folder = page.locator('#custom_cache-hidden-cards .card-container').last();
    await folder.locator('.expand-zone').click();
    const panel = folder.locator('.sub-cards.expanded');
    await panel.waitFor({ state: 'visible' });
    await page.waitForTimeout(700);
    await panel.scrollIntoViewIfNeeded();
    const geometry = await panel.evaluate(element => {
        const scope = element.closest('.hidden-cards');
        const collapse = document.getElementById('custom_cache-collapse-btn');
        const row = element.querySelector('.sub-card');
        const rect = element.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const hit = document.elementFromPoint(rowRect.left + rowRect.width / 2, rowRect.top + rowRect.height / 2);
        return {
            reserved: scope.classList.contains('has-expanded-subcards'),
            withinScope: rect.bottom <= scope.getBoundingClientRect().bottom + 1,
            beforeButton: rect.bottom <= collapse.getBoundingClientRect().top + 1,
            clickable: hit === row || row.contains(hit)
        };
    });
    assert.deepEqual(geometry, { reserved: true, withinScope: true, beforeButton: true, clickable: true });
}

async function verifyRevision(page) {
    assert.equal(await page.locator('meta[name="cache-test-revision"]').getAttribute('content'), String(revision), 'reload returned stale HTML');
    await page.evaluate(() => window.__SmartToolsDataReady);
}

try {
    browser = await chromium.launch({
        executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true
    });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
        legacy = true;
        homeCacheControl = 'public, no-cache';
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        await page.goto(base + '/cache-test');
        await page.evaluate(async () => {
            await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready;
            const cache = await caches.open('smarttools-v1-content');
            await cache.put('/', new Response('<!doctype html><h1 id="stale-home">Old cached home</h1>', { headers: { 'Content-Type': 'text/html' } }));
            await caches.open('smarttools-v1-meta');
            await caches.open('unrelated-app-cache');
        });
        await page.waitForFunction(() => !!navigator.serviceWorker.controller);
        await page.goto(base + '/');
        assert.equal(await page.locator('#stale-home').count(), 1, 'legacy cache fixture was not active');
        legacy = false;
        await page.evaluate(async () => {
            const changed = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
            await (await navigator.serviceWorker.getRegistration()).update();
            await changed;
        });
        // controllerchange can precede completion of activate's cache cleanup.
        await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
        const names = await page.evaluate(() => caches.keys());
        assert(!names.includes('smarttools-v1-content') && !names.includes('smarttools-v1-meta'), `old SmartTools caches survived activation: ${JSON.stringify(names)}`);
        assert(names.includes('unrelated-app-cache'), 'activation deleted another application cache');
        await page.reload({ waitUntil: 'networkidle' });
        await verifyRevision(page);
        await verifyLayer(page);

        // The first normal reload after a deployment must return the new HTML,
        // even with a warm SW cache AND an old immutable HTTP cache entry.
        homeCacheControl = 'public, max-age=31536000, immutable';
        await page.reload({ waitUntil: 'networkidle' });
        revision++;
        const before = homeRequests;
        await page.reload({ waitUntil: 'networkidle' });
        assert(homeRequests > before, 'normal reload did not revalidate immutable HTTP cache');
        await verifyRevision(page);
        await verifyLayer(page);
        revision++;
        await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
        await verifyRevision(page);
        revision++;
        await page.reload({ waitUntil: 'networkidle' });
        await verifyRevision(page);
        await verifyLayer(page);

        // Hard reload must agree with F5; it is not required to get the fix.
        const cdp = await context.newCDPSession(page);
        const hardReloaded = page.waitForEvent('load');
        await cdp.send('Page.reload', { ignoreCache: true });
        await hardReloaded;
        await verifyRevision(page);
        await verifyLayer(page);
        await cdp.detach();
        // Re-enter the SW path, then verify offline HTML and public fixture data.
        await page.reload({ waitUntil: 'networkidle' });
        await context.setOffline(true);
        await page.reload({ waitUntil: 'load' });
        await verifyRevision(page);
        await verifyLayer(page);
        await context.setOffline(false);

        const cachedRevision = revision;
        revision++;
        homeCacheControl = 'private, no-store';
        await page.reload({ waitUntil: 'networkidle' });
        await verifyRevision(page);
        await page.evaluate(async () => {
            await fetch('/shared/cache-test-private.js');
            await fetch('/shared/cache-test-missing.js');
        });
        const cached = await page.evaluate(async () => {
            const name = (await caches.keys()).find(key => key.startsWith('smarttools-') && key.endsWith('-content'));
            const cache = await caches.open(name);
            return { html: await (await cache.match('/index.html')).text(), urls: (await cache.keys()).map(req => new URL(req.url).pathname) };
        });
        assert(cached.html.includes(`name="cache-test-revision" content="${cachedRevision}"`), 'private/no-store HTML replaced the public offline copy');
        assert(!cached.urls.some(url => url.startsWith('/api/') || url.includes('cache-test-private') || url.includes('cache-test-missing')), 'nonpublic or failed responses entered the SW cache');
        await context.close();
    }
    console.log(JSON.stringify({ ok: true, viewports: ['desktop', 'mobile'], legacyCacheMigration: true, ordinaryReload: true, hardReload: true, immutableHttpCache: true, offlineFallback: true, expandedLayerHitTest: true, privateCacheExcluded: true }, null, 2));
} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
}
