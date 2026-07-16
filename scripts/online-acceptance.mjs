import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const base = process.env.SMARTTOOLS_BASE_URL || 'https://www.303066.xyz';
const pagesBase = process.env.SMARTTOOLS_PAGES_URL || 'https://smarttools-4xj.pages.dev';
const executablePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function readRemoteAdminCredentials() {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'smarttools-pages-config-'));
    const wrangler = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    try {
        const result = spawnSync(process.execPath, [wrangler, 'pages', 'download', 'config', 'smarttools', '--cwd', temp, '--force'], {
            encoding: 'utf8',
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024
        });
        if (result.status !== 0) throw new Error(`Unable to download Pages settings: ${result.error || result.stderr || result.stdout}`);
        const toml = fs.readFileSync(path.join(temp, 'wrangler.toml'), 'utf8');
        const read = key => {
            const match = toml.match(new RegExp(`^${key}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")\\s*$`, 'm'));
            return match ? JSON.parse(match[1]) : '';
        };
        const username = read('ADMIN_USER');
        const password = read('ADMIN_PASS');
        if (!username || !password) throw new Error('Remote administrator variables are unavailable');
        return { username, password };
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

async function request(root, route, options = {}) {
    const response = await fetch(root + route, options);
    const type = response.headers.get('content-type') || '';
    return {
        response,
        body: type.includes('json') ? await response.json() : await response.text()
    };
}

const credentials = readRemoteAdminCredentials();
const anonymousCheck = await request(base, '/api/check');
assert(anonymousCheck.response.status === 200 && anonymousCheck.body.loggedIn === false, 'anonymous production check failed');
assert(!('migrationNeeded' in anonymousCheck.body) && !('inboxPolicy' in anonymousCheck.body), 'removed check fields remain');

const siteConfig = await request(base, '/api/site-config');
assert(siteConfig.response.status === 200 && !('defaultTheme' in siteConfig.body), 'removed theme configuration remains online');

const publicData = await request(base, '/api/data?format=json');
assert(publicData.response.status === 200 && publicData.body.privateFiltered === true, 'production public data filter flag failed');
assert(!/\bprivate\s*:\s*true\b/.test(publicData.body.content), 'Private section leaked in production');
assert(!/\bencrypted\s*:\s*true\b|\benc\s*:/.test(publicData.body.content), 'legacy ciphertext leaked in production');
assert(publicData.body.siteConfig && publicData.body.siteConfig.title === siteConfig.body.title, 'production data response did not merge site config');

const publicJsFirst = await request(base, '/api/data');
await new Promise(resolve => setTimeout(resolve, 500));
const publicJsSecond = await request(base, '/api/data');
assert(publicJsSecond.body.includes('window.__siteConfig') && publicJsSecond.body.includes('window.__viewerInfo'), 'production bootstrap metadata missing');
assert(publicJsSecond.response.headers.get('x-smarttools-cache') === 'HIT', 'production public edge cache did not hit');

const login = await request(base, '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials)
});
assert(login.response.status === 200 && login.body.role === 'admin', 'production admin login failed');
const cookie = (login.response.headers.get('set-cookie') || '').split(';')[0];
assert(cookie.startsWith('auth='), 'production auth cookie missing');

const adminData = await request(base, '/api/data?format=json', { headers: { Cookie: cookie } });
assert(adminData.response.status === 200 && adminData.body.privateFiltered === false, 'production admin data failed');
assert(!/\bencrypted\s*:\s*true\b|\benc\s*:/.test(adminData.body.content), 'legacy ciphertext remains in admin data');
if (/\bprivate\s*:\s*true\b/.test(adminData.body.content)) {
    assert(adminData.body.content !== publicData.body.content, 'Private production data was not filtered');
}
const adminJs = await request(base, '/api/data', { headers: { Cookie: cookie } });
assert((adminJs.response.headers.get('cache-control') || '').includes('no-store'), 'production admin data is cacheable');
const publicAfterAdmin = await request(base, '/api/data');
assert(!/\bprivate\s*:\s*true\b/.test(publicAfterAdmin.body), 'production public cache was contaminated by admin data');

for (const endpoint of ['/api/users', '/api/archives', '/api/public-slug', '/api/inbox', '/api/push', '/api/migrate-v2', '/api/change-password']) {
    const result = await request(base, endpoint);
    assert(result.response.status === 404 && result.body.ok === false, `obsolete production endpoint active: ${endpoint}`);
}

for (const root of [base, pagesBase]) {
    const home = await request(root, '/');
    assert(home.response.status === 200, `home unavailable: ${root}`);
    assert(!home.body.includes('styleSwitcher') && !/index[1-5]\.html/.test(home.body), `multi-theme homepage remains: ${root}`);
    const config = await request(root, '/config.html');
    assert(config.response.status === 200, `config unavailable: ${root}`);
    for (const id of ['btnUsers', 'btnMySlug', 'btnPush', 'btnP2pPush', 'btnInbox', 'btnMigrate', 'btnChangePwd']) {
        assert(!config.body.includes(`id="${id}"`), `removed control remains online: ${id}`);
    }
    assert(!config.body.includes('siteConfigDefaultThemeInput'), `removed theme configuration remains: ${root}`);
    for (let theme = 1; theme <= 5; theme++) {
        for (const suffix of ['', '.html']) {
            const route = `/index${theme}${suffix}`;
            const result = await request(root, route, { redirect: 'manual' });
            const location = result.response.headers.get('location') || '';
            assert(result.response.status === 301 && new URL(location, root).pathname === '/', `legacy theme route did not redirect: ${root}${route}`);
        }
    }
    for (const asset of ['/shared/data-loader.js', '/extensions/open-tabs-importer/manifest.json', '/extensions/open-tabs-importer.zip']) {
        const result = await request(root, asset);
        assert(result.response.status === 200, `required public asset unavailable: ${root}${asset}`);
    }
    for (const asset of [
        '/README.md',
        '/README_CN.md',
        '/package.json',
        '/package-lock.json',
        '/scripts/acceptance.mjs',
        '/scripts/online-acceptance.mjs',
        '/scripts/sanitize-remote-kv.mjs',
        '/scripts/refactor-single-admin.mjs',
        '/.github/workflows/deploy.yml'
    ]) {
        const result = await request(root, asset);
        assert(result.response.status === 404, `development asset is publicly accessible: ${root}${asset}`);
    }
}

const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];
try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base + '/config.html', { waitUntil: 'networkidle' });
    await page.locator('#authPage:not(.hidden)').waitFor();
    await page.locator('#authUser').fill(credentials.username);
    await page.locator('#authPass').fill(credentials.password);
    await page.locator('#authBtn').click();
    await page.locator('#mainPage:not(.hidden)').waitFor({ timeout: 15000 });
    assert(await page.locator('#btnIoHub').count() === 1, 'production import/export hub missing');
    assert(await page.locator('#btnOpenTabsImportTop').count() === 1, 'production open-tabs importer missing');
    assert(await page.locator('#siteConfigDefaultThemeInput').count() === 0, 'production theme configuration remains');

    const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const publicPage = await publicContext.newPage();
    const publicRequests = [];
    publicPage.on('request', request => publicRequests.push(new URL(request.url()).pathname));
    publicPage.on('pageerror', error => errors.push(error.message));
    publicPage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await publicPage.goto(base + '/', { waitUntil: 'networkidle' });
    await publicPage.evaluate(() => window.__SmartToolsDataReady);
    assert(await publicPage.locator('#styleSwitcher').count() === 0, 'production theme switcher remains');
    assert(await publicPage.locator('.link-card').count() >= 1, 'production mobile homepage cards missing');
    assert(publicRequests.filter(pathname => pathname === '/api/site-config').length === 0, 'production homepage requested site config separately');
    assert(publicRequests.filter(pathname => pathname === '/api/data').length === 1, 'production homepage did not use one combined data request');
    assert(publicRequests.filter(pathname => pathname === '/shared/fav-page.js').length === 0, 'production homepage runtime was not inlined');
    assert(publicRequests.filter(pathname => pathname === '/shared/note-modal.js').length === 0, 'production note modal loaded on the initial path');
    await publicPage.evaluate(() => window.__SmartToolsLoadNoteModal());
    assert(await publicPage.evaluate(() => !!window.NoteModal), 'production note modal failed to load on demand');
    assert(await publicPage.locator('.sub-card').count() === 0, 'production collapsed sub-cards rendered eagerly');
    await publicPage.locator('.expand-zone').first().click();
    await publicPage.locator('.sub-cards.expanded .sub-card').first().waitFor();
    const mobileSubCardTypography = await publicPage.locator('.sub-cards.expanded .compact-card .link-url').first().evaluate(element => {
        const style = getComputedStyle(element);
        return { fontSize: style.fontSize, textOverflow: style.textOverflow, whiteSpace: style.whiteSpace };
    });
    assert(mobileSubCardTypography.fontSize === '12px', `production mobile sub-card font size is inconsistent: ${mobileSubCardTypography.fontSize}`);
    assert(mobileSubCardTypography.textOverflow === 'ellipsis' && mobileSubCardTypography.whiteSpace === 'nowrap', 'production mobile long text truncation is missing');
    await publicContext.close();
    assert(errors.length === 0, `production browser errors: ${errors.join('; ')}`);
} finally {
    await browser.close();
}

console.log(JSON.stringify({
    ok: true,
    base,
    pagesBase,
    anonymousPrivateFiltered: true,
    adminLogin: true,
    legacyCiphertextAbsent: true,
    obsoleteApis404: 7,
    singleThemeOnline: true,
    legacyThemeRedirects: 10,
    developmentAssets404: true,
    browserErrors: []
}, null, 2));
