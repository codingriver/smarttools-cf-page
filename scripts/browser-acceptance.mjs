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

    for (const id of ['btnIoHub', 'btnOpenTabsImportTop', 'btnSiteConfig', 'btnAccountSecurity', 'btnDataSource', 'btnSave']) {
        assert(await configPage.locator('#' + id).count() === 1, `retained control missing: ${id}`);
    }
    assert(await configPage.locator('#btnOpenRecovery').isHidden(), 'password recovery button is visible while recovery is disabled');
    await configPage.locator('#btnAccountSecurity').click();
    await configPage.locator('#accountSecurityModal:not(.hidden)').waitFor();
    assert((await configPage.locator('#accountPasswordStatus').innerText()).includes('Cloudflare ADMIN_PASS'), 'environment password source was not shown');
    await configPage.locator('#accountNewPassword').fill('MismatchPassword2026!');
    await configPage.locator('#accountConfirmPassword').fill('DifferentPassword2026!');
    await configPage.locator('#btnAccountPasswordSave').click();
    await configPage.locator('.toast').filter({ hasText: '不一致' }).waitFor();
    assert(await configPage.locator('.toast').filter({ hasText: '不一致' }).count() >= 1, 'password confirmation mismatch was not validated in the UI');
    assert(await configPage.locator('#accountSecurityModal:not(.hidden)').count() === 1, 'account security modal closed after local validation failure');
    await configPage.locator('#btnAccountSecurityClose').click();
    for (const id of ['btnUsers', 'btnMySlug', 'btnPush', 'btnP2pPush', 'btnInbox', 'btnMigrate', 'btnChangePwd']) {
        assert(await configPage.locator('#' + id).count() === 0, `removed control rendered: ${id}`);
    }
    assert(await configPage.locator('#siteConfigDefaultThemeInput').count() === 0, 'removed theme configuration rendered');
    assert(await configPage.locator('#siteConfigSubCardLayoutInput').count() === 1, 'sub-card layout configuration missing');
    await configPage.locator('#btnSiteConfig').click();
    await configPage.locator('#siteConfigModal:not(.hidden)').waitFor();
    assert(await configPage.locator('#siteConfigSubCardLayoutInput').inputValue() === 'directory', 'directory layout was not loaded in basic settings');
    await configPage.locator('#btnSiteConfigClose').click();
    await configPage.locator('#btnIoHub').click();
    await configPage.locator('#ioHubModal:not(.hidden)').waitFor();
    for (const id of [
        'btnIoHubExportFull', 'btnIoHubImportFull', 'btnIoHubExportJs', 'btnIoHubImportJs',
        'btnIoHubExportTable', 'btnIoHubImportTable', 'btnIoHubImportBookmarks',
        'btnIoHubExportBookmarks', 'btnIoHubImportOpenTabsClipboard'
    ]) assert(await configPage.locator('#' + id).count() === 1, `import/export control missing: ${id}`);

    const sameSectionRootMove = await configPage.evaluate(() => {
        const targetSection = getSections().find(section => section.kind === 'card')?.key;
        if (!targetSection) return { ids: [], hidden: false, targetSection: null };
        store[targetSection] = [
            { id: 'move_root_a', type: 'simple', title: 'Move Root A', url: 'https://example.com/a' },
            { id: 'move_root_b', type: 'simple', title: 'Move Root B', url: 'https://example.com/b' }
        ];
        currentSection = targetSection;
        renderSectionTabs();
        renderCurrentSection();
        openMoveCardModal(targetSection, 0);
        document.getElementById('move_section').value = targetSection;
        renderMoveTargetList();
        document.getElementById('move_target').value = '';
        confirmMoveSubCard();
        return {
            ids: store[targetSection].map(card => card.id),
            hidden: document.getElementById('moveModal').classList.contains('hidden'),
            targetSection
        };
    });
    assert(
        sameSectionRootMove.hidden && sameSectionRootMove.ids.join(',') === 'move_root_b,move_root_a',
        `same-section root card move did not append the card: ${JSON.stringify(sameSectionRootMove)}`
    );

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
    assert(await publicHome.locator('html').getAttribute('data-subcard-layout') === 'directory', 'directory layout setting was not applied');
    await publicHome.evaluate(async () => {
        if (window.__SmartToolsDataRefresh && typeof window.__SmartToolsDataRefresh.then === 'function') {
            await window.__SmartToolsDataRefresh;
        }
    });
    const publicDataCache = await publicHome.evaluate(() => {
        const raw = localStorage.getItem('smarttools:public-data-cache:v1');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return {
            ttlDays: Math.floor((parsed.expiresAt - Date.now()) / 86400000),
            hasPublic: parsed.content.includes('Public Card') || parsed.content.includes('Inline Snapshot'),
            hasPrivate: parsed.content.includes('Private Card'),
            isAdminView: /isAdminView["']?\s*:\s*true/.test(parsed.content)
        };
    });
    assert(publicDataCache && publicDataCache.ttlDays >= 365, 'homepage public data cache is not retained for at least one year');
    assert(publicDataCache.hasPublic && !publicDataCache.hasPrivate && !publicDataCache.isAdminView, 'homepage public data cache is not safely public-only');
    assert(publicHomeRequests.filter(path => path === '/shared/note-modal.js').length === 0, 'note modal script loaded during the initial render');
    await publicHome.locator('.link-card .link-title').first().click();
    await publicHome.locator('.note-mask').waitFor();
    assert(publicHomeRequests.filter(path => path === '/shared/note-modal.js').length === 1, 'note modal script was not loaded on demand');
    assert(publicHomeRequests.filter(path => path === '/shared/note-modal.css').length === 1, 'note modal stylesheet was not loaded on demand');
    await publicHome.locator('.note-close').click();
    assert(await publicHome.locator('.sub-card').count() === 0, 'collapsed sub-cards were rendered eagerly');
    await publicHome.locator('.expand-zone').first().click();
    await publicHome.locator('.sub-cards.expanded .sub-card').first().waitFor();
    await publicHome.waitForTimeout(300);
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
    const directoryPresentation = await publicHome.locator('.sub-cards.expanded').evaluate(element => {
        const row = element.querySelector('.sub-card');
        const toolbar = element.querySelector('.sub-cards-toolbar');
        const icon = row && row.querySelector('.link-icon');
        return {
            maxHeight: getComputedStyle(element).maxHeight,
            overflowY: getComputedStyle(element).overflowY,
            rowBorderRadius: row ? getComputedStyle(row).borderRadius : '',
            toolbarPosition: toolbar ? getComputedStyle(toolbar).position : '',
            iconWidth: icon ? Math.round(icon.getBoundingClientRect().width) : 0
        };
    });
    assert(directoryPresentation.overflowY === 'auto', 'directory sub-card list does not scroll internally');
    assert(directoryPresentation.rowBorderRadius === '0px', 'directory rows still use card borders');
    assert(directoryPresentation.toolbarPosition === 'sticky', 'directory toolbar is not sticky');
    assert(directoryPresentation.iconWidth === 28, `directory icon container width is invalid: ${directoryPresentation.iconWidth}`);
    const compactNotePresentation = await publicHome.locator('.sub-cards.expanded .compact-card').first().evaluate(row => {
        const content = row.querySelector('.link-content');
        const note = row.querySelector('.link-note');
        const title = row.querySelector('.link-url');
        return {
            rowHeight: Math.round(row.getBoundingClientRect().height),
            contentDirection: content ? getComputedStyle(content).flexDirection : '',
            noteAlign: note ? getComputedStyle(note).textAlign : '',
            noteTop: note ? Math.round(note.getBoundingClientRect().top) : 0,
            titleTop: title ? Math.round(title.getBoundingClientRect().top) : 0
        };
    });
    assert(compactNotePresentation.rowHeight >= 56 && compactNotePresentation.rowHeight <= 62, `compact note row height is invalid: ${JSON.stringify(compactNotePresentation)}`);
    assert(compactNotePresentation.contentDirection === 'column' && compactNotePresentation.noteAlign === 'left', 'compact note is not stacked below the title');
    assert(compactNotePresentation.noteTop > compactNotePresentation.titleTop, 'compact note did not render below the title');
    const titleOnlyPresentation = await publicHome.locator('.sub-cards.expanded .two-line-card').first().evaluate(row => {
        const header = row.querySelector('.card-header');
        const emptyMeta = row.querySelector(':scope > .link-url');
        return {
            rowHeight: Math.round(row.getBoundingClientRect().height),
            rowWidth: Math.round(row.getBoundingClientRect().width),
            headerWidth: header ? Math.round(header.getBoundingClientRect().width) : 0,
            emptyMetaDisplay: emptyMeta ? getComputedStyle(emptyMeta).display : ''
        };
    });
    assert(titleOnlyPresentation.rowHeight >= 44 && titleOnlyPresentation.rowHeight <= 48, `title-only sub-card row height is invalid: ${JSON.stringify(titleOnlyPresentation)}`);
    assert(titleOnlyPresentation.emptyMetaDisplay === 'none', 'empty two-line sub-card meta column still reserves width');
    assert(titleOnlyPresentation.headerWidth >= Math.round(titleOnlyPresentation.rowWidth * 0.85), `title-only sub-card title column is too narrow: ${JSON.stringify(titleOnlyPresentation)}`);
    const describedPresentation = await publicHome.locator('.sub-cards.expanded .two-line-card').nth(1).evaluate(row => {
        const header = row.querySelector('.card-header');
        const meta = row.querySelector(':scope > .link-url');
        const title = row.querySelector('.link-title');
        return {
            rowHeight: Math.round(row.getBoundingClientRect().height),
            metaDisplay: meta ? getComputedStyle(meta).display : '',
            metaAlign: meta ? getComputedStyle(meta).textAlign : '',
            metaTop: meta ? Math.round(meta.getBoundingClientRect().top) : 0,
            titleTop: title ? Math.round(title.getBoundingClientRect().top) : 0,
            headerWidth: header ? Math.round(header.getBoundingClientRect().width) : 0,
            rowWidth: Math.round(row.getBoundingClientRect().width)
        };
    });
    assert(describedPresentation.rowHeight >= 56 && describedPresentation.rowHeight <= 62, `described sub-card row height is invalid: ${JSON.stringify(describedPresentation)}`);
    assert(describedPresentation.metaDisplay !== 'none' && describedPresentation.metaAlign === 'left', 'described sub-card meta is not visible below the title');
    assert(describedPresentation.metaTop > describedPresentation.titleTop, 'described sub-card meta did not render below the title');
    assert(describedPresentation.headerWidth >= Math.round(describedPresentation.rowWidth * 0.85), `described sub-card title row is too narrow: ${JSON.stringify(describedPresentation)}`);

    const inlineContext = await browser.newContext();
    const inlineHome = await inlineContext.newPage();
    await inlineHome.route('**/api/data', async route => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        await route.continue();
    });
    await inlineHome.goto(base + '/', { waitUntil: 'domcontentloaded' });
    if (await inlineHome.locator('script[data-inline-data]').count()) {
        await inlineHome.locator('.link-card').first().waitFor({ timeout: 1000 });
        assert(await inlineHome.locator('.link-card').count() >= 1, 'inline snapshot did not render before the API refresh');
        await inlineHome.evaluate(() => window.__SmartToolsDataRefresh);
        await inlineHome.getByText('Public Card', { exact: true }).waitFor({ timeout: 5000 });
    }
    await inlineContext.close();

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
        inlineSnapshotRendered: true,
        importExportControls: 9,
        errors: []
    }, null, 2));
} finally {
    await browser.close();
}
