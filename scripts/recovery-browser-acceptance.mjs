import { chromium } from 'playwright-core';

const base = process.env.SMARTTOOLS_BASE_URL || 'http://127.0.0.1:8789';
const executablePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(base + '/config.html?recover=1', { waitUntil: 'networkidle' });
  await page.locator('#authPage:not(.hidden)').waitFor();
  assert(await page.locator('#btnOpenRecovery').isVisible(), 'enabled recovery action is not visible');
  await page.locator('#passwordRecoveryModal:not(.hidden)').waitFor();
  assert(await page.locator('#recoveryTokenInput').getAttribute('type') === 'password', 'recovery token field is not masked');
  assert((await page.locator('#recoveryCleanupHint').innerText()).includes('PASSWORD_RECOVERY_TOKEN'), 'recovery cleanup guidance is missing');
  assert(!page.url().includes('PASSWORD_RECOVERY_TOKEN') && !page.url().includes('one-time-recovery'), 'recovery token leaked into the URL');
  assert(errors.length === 0, `recovery browser errors:\n${errors.join('\n')}`);
  console.log(JSON.stringify({
    ok: true,
    base,
    recoveryActionVisible: true,
    recoveryModalAutoOpened: true,
    recoveryTokenMasked: true,
    recoveryTokenInUrl: false,
    errors: []
  }, null, 2));
} finally {
  await browser.close();
}
