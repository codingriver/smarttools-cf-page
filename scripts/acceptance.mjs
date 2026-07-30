const base = process.env.SMARTTOOLS_BASE_URL || 'http://127.0.0.1:8788';
const username = process.env.SMARTTOOLS_TEST_USER || 'testadmin';
const password = process.env.SMARTTOOLS_TEST_PASS || 'TestPass2026';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
    const response = await fetch(base + path, options);
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('json') ? await response.json() : await response.text();
    return { response, body };
}

async function json(path, method = 'GET', body, cookie) {
    return request(path, {
        method,
        headers: {
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(cookie ? { Cookie: cookie } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
}

const testData = `/* acceptance fixture */
var sections = [
    { key: 'public_links', kind: 'card', label: 'Public', visible: true, dynamic: false, cards: [
        { id: 'public_card', type: 'expandable', title: 'Public Card', url: 'https://example.com', comment: 'Acceptance parent note', subCards: [
            { id: 'public_sub_card', type: 'compact', icon: 'P', content: 'Public Sub Card With A Very Long Title That Must Be Truncated', note: 'Compact note underneath', url: 'https://example.com/sub' },
            { id: 'public_title_only_sub_card', icon: 'P', title: 'Public Title Only Sub Card With A Very Long Title', url: 'https://example.com/title-only' },
            { id: 'public_desc_sub_card', icon: 'P', title: 'Public Described Sub Card With A Very Long Title', desc: 'Two-line description underneath', url: 'https://example.com/described' }
        ] }
    ] },
    { key: 'private_links', kind: 'card', label: 'Private', visible: true, dynamic: false, private: true, cards: [
        { id: 'private_card', type: 'simple', title: 'Private Card', url: 'https://private.example.com' }
    ] },
    { key: 'legacy_secret', kind: 'card', label: 'Legacy encrypted', encrypted: true, enc: { data: 'discard-me' }, cards: [] }
];
`;

const checkAnon = await json('/api/check');
assert(checkAnon.response.status === 200 && checkAnon.body.loggedIn === false, 'anonymous check failed');

const deniedSave = await json('/api/save', 'POST', { content: testData });
assert(deniedSave.response.status === 401, 'anonymous save was not denied');

const badLogin = await json('/api/login', 'POST', { username, password: 'wrong-password' });
assert(badLogin.response.status === 401, 'bad login was not denied');

const login = await json('/api/login', 'POST', { username, password });
assert(login.response.status === 200 && login.body.role === 'admin', 'admin login failed');
const setCookie = login.response.headers.get('set-cookie') || '';
const cookie = setCookie.split(';')[0];
assert(cookie.startsWith('auth='), 'auth cookie missing');

const save = await json('/api/save', 'POST', { content: testData }, cookie);
assert(save.response.status === 200 && save.body.ok, 'fixture save failed');

const adminData = await json('/api/data?format=json', 'GET', undefined, cookie);
assert(adminData.response.status === 200 && adminData.body.privateFiltered === false, 'admin data flags invalid');
assert(adminData.body.content.includes('Private Card'), 'admin cannot see Private content');
assert(adminData.body.content.includes('Public Card'), 'admin cannot see public content');
assert(!adminData.body.content.includes('legacy_secret') && !adminData.body.content.includes('discard-me'), 'legacy encrypted section was retained');

const publicData = await json('/api/data?format=json');
assert(publicData.response.status === 200 && publicData.body.privateFiltered === true, 'public data flags invalid');
assert(publicData.body.content.includes('Public Card'), 'public content missing');
assert(!publicData.body.content.includes('Private Card') && !publicData.body.content.includes('private_links'), 'Private content leaked anonymously');
assert(publicData.body.siteConfig && publicData.body.siteConfig.title === 'SmartTools Acceptance', 'site config was not merged into data response');

const directJs = await request('/api/data');
assert(directJs.response.status === 200, 'javascript data endpoint failed');
assert(
    (directJs.response.headers.get('cache-control') || '') === 'public, max-age=31536000, s-maxage=86400, stale-while-revalidate=31536000',
    'public data cache policy is invalid'
);
assert(!directJs.body.includes('Private Card') && directJs.body.includes('Public Card'), 'javascript response privacy filter failed');
assert(directJs.body.includes('window.__siteConfig') && directJs.body.includes('window.__viewerInfo'), 'javascript bootstrap metadata missing');

const adminDirectJs = await request('/api/data', { headers: { Cookie: cookie } });
assert(adminDirectJs.body.includes('Private Card'), 'authenticated javascript response lost Private data');
assert((adminDirectJs.response.headers.get('cache-control') || '').includes('no-store'), 'authenticated data response is cacheable');

const publicAfterAdmin = await request('/api/data');
assert(!publicAfterAdmin.body.includes('Private Card'), 'public cache was contaminated by authenticated data');

const publicMeta = await json('/api/data-meta');
const adminMeta = await json('/api/data-meta', 'GET', undefined, cookie);
assert(publicMeta.body.privateFiltered === true && adminMeta.body.privateFiltered === false, 'metadata privacy scope failed');
assert(publicMeta.body.dataEtag !== adminMeta.body.dataEtag, 'public/admin ETags must differ');

const accountSecurityDenied = await json('/api/account/security');
assert(accountSecurityDenied.response.status === 401, 'anonymous account security access was not denied');
const passwordChangeDenied = await json('/api/account/change-password', 'POST', { currentPassword: password, newPassword: 'NewSecurePass2026' });
assert(passwordChangeDenied.response.status === 401, 'anonymous password change was not denied');
const recoveryDisabled = await json('/api/account/recovery');
assert(recoveryDisabled.response.status === 200 && recoveryDisabled.body.recoveryEnabled === false, 'password recovery should be disabled by default');

const sourceDenied = await json('/api/source', 'POST', { source: 'kv' });
assert(sourceDenied.response.status === 401, 'anonymous source mutation was not denied');
const sourceSet = await json('/api/source', 'POST', { source: 'kv' }, cookie);
assert(sourceSet.response.status === 200 && sourceSet.body.source === 'kv', 'source update failed');

const siteSet = await json('/api/site-config', 'POST', {
    title: 'SmartTools Acceptance',
    defaultTheme: 'mint',
    subCardLayout: 'directory',
    autoBackupEnabled: true,
    backupRetention: 3
}, cookie);
assert(siteSet.response.status === 200 && !('defaultTheme' in siteSet.body), 'site config retained removed theme field');
assert(siteSet.body.subCardLayout === 'directory', 'site config did not persist directory layout');
const siteInvalidLayout = await json('/api/site-config', 'POST', { subCardLayout: 'unsupported' }, cookie);
assert(siteInvalidLayout.body.subCardLayout === 'directory', 'invalid sub-card layout did not fall back to current valid value');
const siteGet = await json('/api/site-config');
assert(siteGet.body.title === 'SmartTools Acceptance' && siteGet.body.subCardLayout === 'directory' && !('defaultTheme' in siteGet.body), 'site config read failed');

const backupCreate = await json('/api/backups?action=create', 'POST', {}, cookie);
assert(backupCreate.response.status === 200 && backupCreate.body.backup, 'manual backup failed');
const backupList = await json('/api/backups', 'GET', undefined, cookie);
assert(Array.isArray(backupList.body.backups) && backupList.body.backups.length >= 1, 'backup list failed');

const comment = await json('/api/comment', 'POST', {
    path: ['sections', 0, 'cards', 0, 'comment'],
    comment: 'Acceptance note'
}, cookie);
assert(comment.response.status === 200 && comment.body.ok, 'comment update failed');
const afterComment = await json('/api/data?format=json', 'GET', undefined, cookie);
assert(afterComment.body.content.includes('Acceptance note'), 'comment was not persisted');

for (const endpoint of ['/api/users', '/api/archives', '/api/public-slug', '/api/inbox', '/api/push', '/api/migrate-v2', '/api/change-password']) {
    const result = await request(endpoint);
    assert(result.response.status === 404, `obsolete endpoint still exists: ${endpoint} (${result.response.status})`);
}

for (const asset of [
    '/', '/config.html',
    '/shared/csv-schema.js', '/shared/xlsx-adapter.js', '/shared/zip-adapter.js',
    '/extensions/open-tabs-importer/manifest.json'
]) {
    const result = await request(asset);
    assert(result.response.status === 200, `retained asset unavailable: ${asset}`);
}

for (let theme = 1; theme <= 5; theme++) {
    for (const suffix of ['', '.html']) {
        const route = `/index${theme}${suffix}`;
        const result = await request(route, { redirect: 'manual' });
        const location = result.response.headers.get('location') || '';
        assert(result.response.status === 301 && new URL(location, base).pathname === '/', `legacy theme route did not redirect: ${route}`);
    }
}

const config = await request('/config.html');
for (const id of ['btnUsers', 'btnMySlug', 'btnPush', 'btnP2pPush', 'btnInbox', 'btnMigrate', 'btnChangePwd']) {
    assert(!config.body.includes(`id="${id}"`), `removed UI control remains: ${id}`);
}
for (const api of ['/api/users', '/api/inbox', '/api/push', '/api/public-slug', '/api/migrate-v2']) {
    assert(!config.body.includes(api), `removed API reference remains in config: ${api}`);
}
assert(!config.body.includes('siteConfigDefaultThemeInput'), 'removed theme configuration remains');
assert(config.body.includes('id="siteConfigSubCardLayoutInput"'), 'sub-card layout configuration is missing');
const configLogic = await request('/shared/config-app.js');
assert(config.body.includes('id="btnAccountSecurity"') && configLogic.body.includes('/api/account/change-password'), 'account security UI or API integration is missing');
assert(config.body.includes('id="passwordRecoveryModal"') && !config.body.includes('PASSWORD_RECOVERY_TOKEN='), 'password recovery UI is missing or embeds a recovery token');

const home = await request('/');
assert(!home.body.includes('styleSwitcher'), 'theme switcher remains on homepage');
assert(!/index[1-5]\.html/.test(home.body), 'legacy theme links remain on homepage');
assert(home.body.includes('<title>CodingRiver书签收藏站</title>'), 'homepage default title is empty');
assert(!home.body.includes('src="shared/data-loader.js"'), 'homepage still blocks on external data loader');
assert(home.body.includes('data-build-output="fav-page-inline"'), 'homepage runtime was not inlined by the production build');
assert(!/<script\b[^>]*\bsrc="shared\/(?:fav-page|note-modal)\.js"/i.test(home.body), 'homepage still has a blocking external runtime script tag');

const pageLogic = await request('/shared/fav-page.js');
assert(!pageLogic.body.includes("fetch('/api/site-config')"), 'homepage still makes a separate site config request');
assert(pageLogic.body.includes('loading="lazy"') && pageLogic.body.includes('ensureSubCardsRendered'), 'lazy media or sub-card rendering is missing');
assert(pageLogic.body.includes('data-subcard-layout') && pageLogic.body.includes('renderSubCardIcon'), 'configurable directory layout or icon fallback is missing');

console.log(JSON.stringify({
    ok: true,
    base,
    checks: 58,
    privateIsolation: true,
    legacyEncryptedDiscarded: true,
    singleTheme: true,
    legacyThemeRedirects: 10,
    extensionRetained: true,
    importExportRetained: true
}, null, 2));
