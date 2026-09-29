import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { onRequest as middleware } from '../functions/_middleware.js';
import { handleBookmarks, CURRENT_KEY } from '../functions/_shared/bookmarks-v2.js';
import { onRequestPost as login } from '../functions/api/login.js';
import { onRequestGet as check } from '../functions/api/check.js';
import { onRequestPost as logout } from '../functions/api/logout.js';
import { onRequestGet as security, onRequestPost as revoke } from '../functions/api/account/security.js';
import { onRequestPost as changePassword } from '../functions/api/account/change-password.js';
import { onRequestPost as recover } from '../functions/api/account/recovery.js';
import { fixture, testEnv } from './bookmarks-v2-fixture.mjs';
await mkdir('.wrangler',{recursive:true});const output=await mkdtemp(path.resolve('.wrangler/retirement-acceptance-'));
const build=mode=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/prepare-deploy.mjs'],{env:{...process.env,SMARTTOOLS_OUTPUT_DIR:output,SMARTTOOLS_INLINE_SNAPSHOT:'0',SMARTTOOLS_BOOKMARKS_MODE:mode},stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code?reject(Error('Retirement build failed')):resolve());});
for(const mode of ['maintenance','v2']) {
 await build(mode);
 assert.equal(await readFile(path.join(output,'index.html'),'utf8'),await readFile(path.join(output,'retired.html'),'utf8'));
 assert.equal(await readFile(path.join(output,'config.html'),'utf8'),await readFile(path.join(output,'retired.html'),'utf8'));
 assert(!/sections\s*=/.test(await readFile(path.join(output,'data.js'),'utf8')));
 assert(!/data-inline-data/.test(await readFile(path.join(output,'index.html'),'utf8')));
 assert.match(await readFile(path.join(output,'account.html'),'utf8'),/account-maintenance.js\?v=[a-f0-9]{8}/);
}
const env=testEnv();env.FAV_KV.data.set(CURRENT_KEY,JSON.stringify({document:fixture(),etag:'"synthetic"'}));
const asset=async input=>{const url=new URL(input),name=url.pathname==='/'?'index.html':url.pathname.slice(1);if(name.includes('..')) return new Response('',{status:404});try{return new Response(await readFile(path.join(output,name)),{headers:{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'}});}catch{return new Response('',{status:404});}};
env.ASSETS={fetch:asset};
for(const mode of ['maintenance','v2']) {env.BOOKMARKS_MODE=mode;for(const route of ['/','/index','/config.html','/config','/c','/sw.js']){const response=await middleware({request:new Request('http://localhost'+route),env,next:()=>new Response('BYPASS')});assert.equal(response.headers.get('Cache-Control'),'no-store');assert(!(await response.text()).includes('BYPASS'));}for(const route of ['/api/data','/api/data-meta','/api/save','/api/backups','/api/source','/data.js'])assert.equal((await middleware({request:new Request('http://localhost'+route),env,next:()=>new Response('BYPASS')})).status,mode==='v2'?410:503);}
env.BOOKMARKS_MODE='v2';let retired=false;
const oldWorker="self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(caches.open('smarttools-v1-content').then(async c=>(await c.match(e.request))||fetch(e.request).then(r=>{c.put(e.request,r.clone());return r;})));});";
const server=http.createServer(async(req,res)=>{try{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 const request=new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
 let response;
 if(!retired&&req.url==='/sw.js')response=new Response(oldWorker,{headers:{'Content-Type':'text/javascript','Cache-Control':'no-cache'}});
 else if(!retired&&req.url==='/')response=new Response('<h1>Old public fixture</h1><script>localStorage.setItem("smarttools:public-data-cache:v1","synthetic");navigator.serviceWorker.register("/sw.js");</script>',{headers:{'Content-Type':'text/html'}});
 else response=await middleware({request,env,next:async()=>req.url==='/api/check'?check({request,env}):req.url==='/api/login'?login({request,env}):req.url==='/api/logout'?logout({request,env}):req.url==='/api/account/security'?(req.method==='POST'?revoke:security)({request,env}):req.url==='/api/account/change-password'?changePassword({request,env}):req.url==='/api/account/recovery'?recover({request,env}):req.url==='/api/v2/bookmarks'?handleBookmarks({request,env}):req.url.startsWith('/api/')?new Response(JSON.stringify({ok:false}),{status:404,headers:{'Content-Type':'application/json'}}):asset('http://localhost'+req.url)});
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch {res.writeHead(500).end('Synthetic server failure');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.EXTENSION_CHROME_PATH||chromium.executablePath(),headless:true});
try {
 const context=await browser.newContext();context.setDefaultTimeout(12000);const page=await context.newPage();
 await page.goto(base);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await page.reload();
 await page.evaluate(async()=>{const c=await caches.open('unrelated-app');await c.put('/keep',new Response('keep'));});
 retired=true;await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
 await page.waitForFunction(async()=>!(await caches.keys()).some(k=>k.startsWith('smarttools-')));await page.reload();
 assert.match(await page.locator('h1').innerText(),/栖页扩展/);assert.equal(await page.evaluate(()=>localStorage.getItem('smarttools:public-data-cache:v1')),null);assert(await page.evaluate(async()=>!!(await (await caches.open('unrelated-app')).match('/keep'))));
 await context.setOffline(true);await page.reload();assert.match(await page.locator('body').innerText(),/书签网站已停用/);await context.setOffline(false);
 await page.goto(base+'/account.html');await page.locator('input[name=username]').fill('testadmin');await page.locator('#login input[name=password]').fill('TestPass2026');await page.locator('#login button').click();await page.locator('#security').waitFor();assert.match(await page.locator('#source').innerText(),/environment/);
 assert.equal((await fetch(base+'/api/v2/bookmarks')).status,401);assert.equal((await fetch(base+'/api/data')).status,410);assert.equal((await fetch(base+'/api/change-password')).status,404);
 // Retained account UI calls the unchanged security APIs, including global revocation and one-time recovery.
 await page.locator('#password input[name=currentPassword]').fill('TestPass2026');await page.locator('#password input[name=newPassword]').fill('ChangedPass2026');await page.locator('#password button').click();await page.locator('#login').waitFor();
 await page.locator('#login input[name=username]').fill('testadmin');await page.locator('#login input[name=password]').fill('ChangedPass2026');await page.locator('#login button').click();await page.locator('#security').waitFor();assert.match(await page.locator('#source').innerText(),/custom/);
 page.once('dialog',d=>d.accept());await page.locator('#revoke').click();await page.locator('#login').waitFor();
 env.PASSWORD_RECOVERY_ENABLED='true';env.PASSWORD_RECOVERY_TOKEN='synthetic-recovery-token-for-testing-only-2026';
 await page.reload();await page.locator('#recovery').waitFor();await page.locator('#recovery summary').click();await page.locator('#recover input[name=recoveryToken]').fill(env.PASSWORD_RECOVERY_TOKEN);await page.locator('#recover input[name=newPassword]').fill('RecoveredPass2026');await page.locator('#recover button').click();await page.locator('#status').filter({hasText:/已更新密码/}).waitFor();
 await page.locator('#login input[name=username]').fill('testadmin');await page.locator('#login input[name=password]').fill('RecoveredPass2026');await page.locator('#login button').click();await page.locator('#security').waitFor();
 const again=await fetch(base+'/api/account/recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recoveryToken:env.PASSWORD_RECOVERY_TOKEN,newPassword:'RepeatedPass2026'})});assert.equal(again.status,409);
 await context.close();console.log('PASS v2/maintenance builds, exact runtime retirement gates, warm SW upgrade/ordinary reload/offline, project-only cache cleanup and retained account login/change-password/revoke/recovery');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
