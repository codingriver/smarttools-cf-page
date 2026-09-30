import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const base=process.env.SMARTTOOLS_BASE_URL || 'http://127.0.0.1:8788';
assert(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname), 'Browser acceptance must use loopback');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
try {
 const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/account.html');
 assert.match(await page.locator('h1').innerText(),/服务端账户配置/);
 assert.equal(await page.locator('form').count(),0);
 assert.equal(await page.locator('script').count(),0);
 assert.match(await page.locator('body').innerText(),/PASSWORD/);
 const anon=await page.evaluate(async()=>{const response=await fetch('/api/v2/auth/session');return {status:response.status,body:await response.json()};});
 assert.equal(anon.status,200);assert.equal(anon.body.loggedIn,false);
 const old=await page.evaluate(async()=>{const response=await fetch('/api/account/recovery');return {status:response.status,body:await response.json()};});
 assert.equal(old.status,410);assert.equal(old.body.code,'AUTH_PROTOCOL_RETIRED');
 const retired=await context.newPage();await retired.goto(base+'/');assert.match(await retired.locator('body').innerText(),/栖页|书签网站已停用/);
 assert.deepEqual(errors,[]);await context.close();
 console.log('PASS real browser v2 account guide, anonymous session, retired APIs and retired homepage');
} finally {await browser.close();}
