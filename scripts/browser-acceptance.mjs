import { chromium } from 'playwright-core';

const base = process.env.SMARTTOOLS_BASE_URL || 'http://127.0.0.1:8788';
const username = process.env.SMARTTOOLS_TEST_USER || 'testadmin';
const password = process.env.SMARTTOOLS_TEST_PASS || 'TestPass2026';
const executablePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function watch(page, label, errors) {
    page.on('pageerror', error => errors.push(`${label}: pageerror: ${error.message}`));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(`${label}: console: ${message.text()}`);
    });
    page.on('requestfailed', request => errors.push(`${label}: request failed: ${request.url()} ${request.failure()?.errorText || ''}`));
}

const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];
try {
    const adminContext = await browser.newContext();
    const configPage = await adminContext.newPage();
    watch(configPage, 'config', errors);
    await configPage.goto(base + '/config.html', { waitUntil: 'networkidle' });
    await configPage.locator('#authPage:not(.hidden)').waitFor();
    await configPage.locator('#authUser').fill(username);
    await configPage.locator('#authPass').fill(password);
    await configPage.locator('#authBtn').click();
    await configPage.locator('#mainPage:not(.hidden)').waitFor({ timeout: 15000 });

    for (const id of ['btnIoHub', 'btnOpenTabsImportTop', 'btnSiteConfig', 'btnDataSource', 'btnSave']) {
        assert(await configPage.locator('#' + id).count() === 1, `retained control missing: ${id}`);
    }
    for (const id of ['btnUsers', 'btnMySlug', 'btnPush', 'btnP2pPush', 'btnInbox', 'btnMigrate', 'btnChangePwd']) {
        assert(await configPage.locator('#' + id).count() === 0, `removed control rendered: ${id}`);
    }
    assert(await configPage.locator('#siteConfigDefaultThemeInput').count() === 0, 'removed theme configuration rendered');
    await configPage.locator('#btnIoHub').click();
    await configPage.locator('#ioHubModal:not(.hidden)').waitFor();
    for (const id of [
        'btnIoHubExportFull', 'btnIoHubImportFull', 'btnIoHubExportJs', 'btnIoHubImportJs',
        'btnIoHubExportTable', 'btnIoHubImportTable', 'btnIoHubImportBookmarks',
        'btnIoHubExportBookmarks', 'btnIoHubImportOpenTabsClipboard'
    ]) assert(await configPage.locator('#' + id).count() === 1, `import/export control missing: ${id}`);

    const adminHome = await adminContext.newPage();
    const adminHomeRequests = [];
    adminHome.on('request', request => adminHomeRequests.push(new URL(request.url()).pathname));
    watch(adminHome, 'admin-home', errors);
    await adminHome.goto(base + '/', { waitUntil: 'networkidle' });
    await adminHome.evaluate(() => window.__SmartToolsDataReady);
    await adminHome.waitForTimeout(300);
    assert((await adminHome.locator('body').innerText()).includes('Private Card'), 'admin homepage did not render Private card');
    assert(await adminHome.locator('#styleSwitcher').count() === 0, 'theme switcher rendered for admin');
    assert(adminHomeRequests.filter(path => path === '/api/data').length === 1, 'admin homepage did not use one combined data request');
    assert(adminHomeRequests.filter(path => path === '/api/site-config').length === 0, 'admin homepage requested site config separately');

    const publicContext = await browser.newContext();
    const publicHome = await publicContext.newPage();
    const publicHomeRequests = [];
    publicHome.on('request', request => publicHomeRequests.push(new URL(request.url()).pathname));
    watch(publicHome, 'public-home', errors);
    await publicHome.goto(base + '/', { waitUntil: 'networkidle' });
    await publicHome.evaluate(() => window.__SmartToolsDataReady);
    await publicHome.waitForTimeout(300);
    const publicBody = await publicHome.locator('body').innerText();
    assert(publicBody.includes('Public Card'), 'homepage did not render public data');
    assert(!publicBody.includes('Private Card'), 'homepage leaked Private data');
    assert(await publicHome.locator('#styleSwitcher').count() === 0, 'theme switcher rendered publicly');
    assert(publicHomeRequests.filter(path => path === '/api/data').length === 1, 'public homepage did not use one combined data request');
    assert(publicHomeRequests.filter(path => path === '/api/site-config').length === 0, 'public homepage requested site config separately');
    assert(await publicHome.title() === 'SmartTools Acceptance', 'merged site title was not applied');
    assert(publicHomeRequests.filter(path => path === '/shared/note-modal.js').length === 0, 'note modal script loaded during the initial render');
    await publicHome.locator('.link-card .link-title').first().click();
    await publicHome.locator('.note-mask').waitFor();
    assert(publicHomeRequests.filter(path => path === '/shared/note-modal.js').length === 1, 'note modal script was not loaded on demand');
    assert(publicHomeRequests.filter(path => path === '/shared/note-modal.css').length === 1, 'note modal stylesheet was not loaded on demand');
    await publicHome.locator('.note-close').click();
    assert(await publicHome.locator('.sub-card').count() === 0, 'collapsed sub-cards were rendered eagerly');
    await publicHome.locator('.expand-zone').first().click();
    await publicHome.locator('.sub-cards.expanded .sub-card').first().waitFor();
    assert((await publicHome.locator('.sub-cards.expanded').innerText()).includes('Public Sub Card'), 'lazy sub-card expansion failed');
    const subCardTypography = await publicHome.locator('.sub-cards.expanded .compact-card .link-url').first().evaluate(element => {
        const style = getComputedStyle(element);
        return {
            fontSize: style.fontSize,
            overflow: style.overflow,
            textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace
        };
    });
    assert(subCardTypography.fontSize === '13px', `desktop compact sub-card font size is inconsistent: ${subCardTypography.fontSize}`);
    assert(subCardTypography.overflow === 'hidden' && subCardTypography.textOverflow === 'ellipsis' && subCardTypography.whiteSpace === 'nowrap', 'long compact sub-card text is not truncated');

    const legacyRoute = await publicContext.newPage();
    await legacyRoute.goto(base + '/index5.html', { waitUntil: 'domcontentloaded' });
    assert(new URL(legacyRoute.url()).pathname === '/', 'legacy theme route did not redirect home');

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const mobileHome = await mobileContext.newPage();
    watch(mobileHome, 'mobile-home', errors);
    await mobileHome.goto(base + '/', { waitUntil: 'networkidle' });
    await mobileHome.evaluate(() => window.__SmartToolsDataReady);
    await mobileHome.waitForTimeout(300);
    assert(await mobileHome.locator('#styleSwitcher').count() === 0, 'theme switcher rendered on mobile');
    assert(await mobileHome.locator('.link-card').count() >= 1, 'mobile homepage cards missing');
    await mobileHome.locator('.expand-zone').first().click();
    const mobileSubCard = mobileHome.locator('.sub-cards.expanded .compact-card .link-url').first();
    await mobileSubCard.waitFor();
    assert(await mobileSubCard.evaluate(element => getComputedStyle(element).fontSize) === '12px', 'mobile compact sub-card font size was reduced');
    await mobileContext.close();

    assert(errors.length === 0, `browser errors:\n${errors.join('\n')}`);
    console.log(JSON.stringify({
        ok: true,
        base,
        adminConfigLoaded: true,
        privateIsolationRendered: true,
        singleThemeRendered: true,
        legacyThemeRedirect: true,
        mobileRendered: true,
        importExportControls: 9,
        errors: []
    }, null, 2));
} finally {
    await browser.close();
}
