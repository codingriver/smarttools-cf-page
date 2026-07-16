import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const base = process.env.SMARTTOOLS_BASE_URL || 'https://www.303066.xyz';
const executablePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactDirectory = path.resolve('artifacts', 'performance');
const rounds = Number(process.env.SMARTTOOLS_PERF_ROUNDS || 5);
const baseOrigin = new URL(base).origin;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function average(values) {
    return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function round(value) {
    return Math.round(Number(value || 0));
}

async function installObservers(context) {
    await context.addInitScript(() => {
        window.__smartPerf = { lcp: 0, cls: 0 };
        try {
            new PerformanceObserver(list => {
                const entries = list.getEntries();
                const last = entries[entries.length - 1];
                if (last) window.__smartPerf.lcp = last.startTime;
            }).observe({ type: 'largest-contentful-paint', buffered: true });
            new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    if (!entry.hadRecentInput) window.__smartPerf.cls += entry.value;
                }
            }).observe({ type: 'layout-shift', buffered: true });
        } catch {}
    });
}

async function measurePage(page, label) {
    const requests = [];
    const errors = [];
    page.on('request', request => requests.push({
        url: request.url(),
        type: request.resourceType()
    }));
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('requestfailed', request => errors.push(`request failed: ${request.url()} ${request.failure()?.errorText || ''}`));

    const wallStart = Date.now();
    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => window.__SmartToolsDataReady);
    await page.locator('.link-card').first().waitFor({ timeout: 15000 });
    const cardsReady = await page.evaluate(() => performance.now());
    await page.waitForTimeout(500);

    const timing = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const resources = performance.getEntriesByType('resource').map(entry => ({
            name: entry.name,
            start: entry.startTime,
            responseStart: entry.responseStart,
            end: entry.responseEnd,
            duration: entry.duration,
            transferSize: entry.transferSize || 0,
            initiator: entry.initiatorType
        }));
        const paint = Object.fromEntries(performance.getEntriesByType('paint').map(entry => [entry.name, entry.startTime]));
        return {
            navigation: {
                dns: nav.domainLookupEnd - nav.domainLookupStart,
                connect: nav.connectEnd - nav.connectStart,
                tls: nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : 0,
                ttfb: nav.responseStart - nav.requestStart,
                htmlDownload: nav.responseEnd - nav.responseStart,
                domContentLoaded: nav.domContentLoadedEventEnd,
                load: nav.loadEventEnd
            },
            resources,
            fcp: paint['first-contentful-paint'] || 0,
            lcp: window.__smartPerf?.lcp || 0,
            cls: window.__smartPerf?.cls || 0
        };
    });

    const pathname = value => {
        try { return new URL(value).pathname; } catch { return ''; }
    };
    const findResource = suffix => timing.resources.find(entry => pathname(entry.name) === suffix);
    const summarizeResource = entry => entry ? {
        start: round(entry.start),
        ttfb: round(entry.responseStart - entry.start),
        download: round(entry.end - entry.responseStart),
        end: round(entry.end),
        transferBytes: entry.transferSize
    } : null;
    const apiRequests = requests.filter(request => pathname(request.url) === '/api/data');
    const siteConfigRequests = requests.filter(request => pathname(request.url) === '/api/site-config');
    const imageRequests = requests.filter(request => request.type === 'image');
    const apiResourceEntries = timing.resources.filter(entry => pathname(entry.name) === '/api/data');
    const siteConfigResourceEntries = timing.resources.filter(entry => pathname(entry.name) === '/api/site-config');

    return {
        label,
        wall: Date.now() - wallStart,
        html: {
            ...Object.fromEntries(Object.entries(timing.navigation).map(([key, value]) => [key, round(value)])),
            fcp: round(timing.fcp),
            lcp: round(timing.lcp),
            cls: Number(timing.cls.toFixed(4)),
            cardsReady: round(cardsReady)
        },
        resources: {
            data: summarizeResource(findResource('/api/data')),
            noteModalCss: summarizeResource(findResource('/shared/note-modal.css')),
            noteModalJs: summarizeResource(findResource('/shared/note-modal.js')),
            favPageJs: summarizeResource(findResource('/shared/fav-page.js'))
        },
        requestCounts: {
            total: requests.length,
            apiData: apiRequests.length,
            siteConfig: siteConfigRequests.length,
            apiDataResources: apiResourceEntries.length,
            siteConfigResources: siteConfigResourceEntries.length,
            images: imageRequests.length,
            thirdPartyImages: imageRequests.filter(request => new URL(request.url).origin !== baseOrigin).length
        },
        errors
    };
}

await fs.mkdir(artifactDirectory, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const cold = [];
const hot = [];

try {
    for (let index = 0; index < rounds; index++) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await installObservers(context);
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        await session.send('Network.setCacheDisabled', { cacheDisabled: true });
        cold.push(await measurePage(page, `cold-${index + 1}`));
        await context.close();
    }

    for (let index = 0; index < rounds; index++) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await installObservers(context);
        const warmup = await context.newPage();
        await measurePage(warmup, `warmup-${index + 1}`);
        await warmup.close();
        const page = await context.newPage();
        hot.push(await measurePage(page, `hot-${index + 1}`));
        await context.close();
    }

    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await installObservers(desktopContext);
    const desktopPage = await desktopContext.newPage();
    await measurePage(desktopPage, 'desktop-screenshot');
    await desktopPage.screenshot({ path: path.join(artifactDirectory, 'homepage-desktop.png'), fullPage: false });
    await desktopContext.close();

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
    await installObservers(mobileContext);
    const mobilePage = await mobileContext.newPage();
    await measurePage(mobilePage, 'mobile-screenshot');
    await mobilePage.screenshot({ path: path.join(artifactDirectory, 'homepage-mobile.png'), fullPage: false });
    await mobileContext.close();
} finally {
    await browser.close();
}

const all = [...cold, ...hot];
assert(all.every(result => result.errors.length === 0), `browser errors: ${all.flatMap(result => result.errors).join('; ')}`);
assert(
    all.every(result => result.requestCounts.apiDataResources === 1),
    `homepage must load exactly one /api/data resource: ${JSON.stringify(all.map(result => ({ label: result.label, apiDataResources: result.requestCounts.apiDataResources, networkEvents: result.requestCounts.apiData })))}`
);
assert(all.every(result => result.requestCounts.siteConfigResources === 0), 'homepage still loads /api/site-config');
assert(cold.every(result => result.requestCounts.thirdPartyImages <= 6), 'too many third-party images load before scrolling');

const summary = {
    ok: true,
    base,
    rounds,
    coldAverage: {
        htmlTtfb: round(average(cold.map(result => result.html.ttfb))),
        domContentLoaded: round(average(cold.map(result => result.html.domContentLoaded))),
        dataReady: round(average(cold.map(result => result.resources.data?.end || 0))),
        cardsReady: round(average(cold.map(result => result.html.cardsReady))),
        fcp: round(average(cold.map(result => result.html.fcp))),
        lcp: round(average(cold.map(result => result.html.lcp))),
        cls: Number(average(cold.map(result => result.html.cls)).toFixed(4)),
        initialImages: Number(average(cold.map(result => result.requestCounts.images)).toFixed(1))
    },
    hotAverage: {
        htmlTtfb: round(average(hot.map(result => result.html.ttfb))),
        domContentLoaded: round(average(hot.map(result => result.html.domContentLoaded))),
        dataReady: round(average(hot.map(result => result.resources.data?.end || 0))),
        cardsReady: round(average(hot.map(result => result.html.cardsReady))),
        fcp: round(average(hot.map(result => result.html.fcp))),
        lcp: round(average(hot.map(result => result.html.lcp))),
        cls: Number(average(hot.map(result => result.html.cls)).toFixed(4)),
        initialImages: Number(average(hot.map(result => result.requestCounts.images)).toFixed(1))
    },
    cold,
    hot,
    screenshots: {
        desktop: path.join(artifactDirectory, 'homepage-desktop.png'),
        mobile: path.join(artifactDirectory, 'homepage-mobile.png')
    }
};

await fs.writeFile(path.join(artifactDirectory, 'performance-results.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
