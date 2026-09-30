import http from 'node:http';
import { testBookmarkTransfer, selectBookmarkFile } from './extension-transfer-scenarios.mjs';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture, testEnv } from './bookmarks-v2-fixture.mjs';
import { CURRENT_KEY, handleBookmarks } from '../functions/_shared/bookmarks-v2.js';
import { onRequestPost as login } from '../functions/api/v2/auth/login.js';
import { onRequestGet as check } from '../functions/api/v2/auth/session.js';
import { onRequestPost as logout } from '../functions/api/v2/auth/logout.js';
const env=testEnv();env.FAV_KV.data.set(CURRENT_KEY,JSON.stringify({document:fixture(),etag:'"initial"'}));
let mode='normal', calls=[];
const server=http.createServer(async(req,res)=>{
 try {
  const chunks=[];for await(const chunk of req) chunks.push(chunk);
  const request=new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
  calls.push([req.method,req.url]);
  let response;
  if(mode==='offline') response=new Response(JSON.stringify({ok:false,error:'Synthetic offline'}),{status:503});
  else if(mode==='invalid' && req.url.startsWith('/api/v2/bookmarks')) response=new Response(JSON.stringify({ok:true,document:{schemaVersion:2,roots:[]},meta:{view:'public',etag:'bad'}}));
  else if(req.url==='/api/v2/auth/login') response=await login({request,env});
  else if(req.url==='/api/v2/auth/logout') response=await logout({request,env});
  else if(req.url==='/api/v2/auth/session') response=await check({request,env});
  else if(req.url.startsWith('/api/v2/bookmarks')) response=await handleBookmarks({request,env},req.url.endsWith('/meta'));
  else response=new Response('Not found',{status:404});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 } catch {res.writeHead(500).end('Synthetic server failure');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
await mkdir('.wrangler',{recursive:true});const directory=await mkdtemp(path.resolve('.wrangler/extension-v2-'));
const staged=path.join(directory,'extension');await cp('extensions/open-tabs-importer',staged,{recursive:true});
await writeFile(path.join(staged,'background.js'), (await readFile(path.join(staged,'background.js'),'utf8')) + `
import { trustedClient as testTrusted, handleMenuClick as testCapture } from './cache-controller.js';
import { readMenuIndex as testMenu, readSnapshot as testRead, writeSnapshot as testWrite } from './cache-db.js';
globalThis.fixtureAPI={trustedClient:testTrusted, handleMenuClick:testCapture, readMenuIndex:testMenu, readSnapshot:testRead, writeSnapshot:testWrite};
`);
const manifest=JSON.parse(await readFile(path.join(staged,'manifest.json'),'utf8'));manifest.host_permissions=[base+'/*'];await writeFile(path.join(staged,'manifest.json'),JSON.stringify(manifest));
const launch=()=>chromium.launchPersistentContext(path.join(directory,'profile'),{executablePath:process.env.EXTENSION_CHROME_PATH||chromium.executablePath(),headless:true,viewport:{width:1280,height:800},args:[`--disable-extensions-except=${staged}`,`--load-extension=${staged}`]});
let context=await launch();context.setDefaultTimeout(12000);const errors=[];
const track=()=>context.on('page',page=>page.on('pageerror',err=>errors.push(err.message)));track();
const worker=await (async()=>context.serviceWorkers()[0]||context.waitForEvent('serviceworker'))();
const extension=`chrome-extension://${new URL(worker.url()).host}/`;
await worker.evaluate(configUrl=>chrome.storage.sync.set({configUrl}),base+'/config.html');
const rpc=(page,action,extra={})=>page.evaluate(async({action,configUrl,extra})=>chrome.runtime.sendMessage({channel:'smarttools-client',action,configUrl,...extra}),{action,configUrl:base+'/config.html',extra});
const snap=async page=>(await rpc(page,'cache.get')).value;
const idle=page=>page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
const editTitle=async(page,title,next)=>{await page.getByRole('button',{name:'书签操作：'+title,exact:true}).click();await page.getByRole('menuitem',{name:'编辑',exact:true}).click();await page.locator('#fields input[name=title]').fill(next);await page.locator('#editForm button[type=submit]').click();};
try {
 const first=await context.newPage();await first.goto(extension+'start.html');await idle(first);
 assert(await first.locator('#importBookmarks').isDisabled());assert(await first.locator('#exportBookmarks').isDisabled());
 await first.locator('#accountTrigger').click();await first.locator('#username').fill('testadmin');await first.locator('#password').fill('TestPass2026');await first.locator('#loginForm button').click();
 await first.getByRole('button',{name:'Private · Private',exact:true}).waitFor();await idle(first);await first.keyboard.press('Escape');
 assert.equal((await snap(first)).document.schemaVersion,2);
 // The popup consumes the same canonical document, not the removed sections wrapper.
 const tab=await context.newPage();await tab.goto(base+'/synthetic-tab');
 const popup=await context.newPage();await popup.addInitScript(()=>{globalThis.__copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{globalThis.__copied.push(text);}},configurable:true});});await popup.goto(extension+'popup.html');await popup.locator('#cacheStatus').filter({hasText:/已连接云端/}).waitFor();assert(!(await popup.locator('#cacheStatus').innerText()).includes('undefined'));assert.equal(await popup.locator('#importActive').count(),0);
 for (const button of ['#copyCurrent','#copyAll']) {
  await popup.locator(button).click();await popup.locator('#status').filter({hasText:/已复制/}).waitFor();
  assert(JSON.parse(await popup.evaluate(()=>globalThis.__copied.at(-1))).some(item=>item.url===base+'/synthetic-tab'));
 }
 await popup.locator('#copyTextCurrent').click();await popup.locator('#status').filter({hasText:/仅 URL|文本/}).waitFor();
 assert((await popup.evaluate(()=>globalThis.__copied.at(-1))).includes(base+'/synthetic-tab'));
 for (const [button, suffix] of [['#exportCurrentFile','.html'],['#exportJsonCurrent','.json']]) {
  const [download]=await Promise.all([popup.waitForEvent('download'),popup.locator(button).click()]);
  assert(download.suggestedFilename().startsWith('qiye-tabs-'));assert(download.suggestedFilename().endsWith(suffix));
  const contents=await readFile(await download.path(),'utf8');
  assert(contents.includes(base+'/synthetic-tab'));
  if(suffix==='.json') assert(Array.isArray(JSON.parse(contents)));
  else assert(contents.includes('NETSCAPE-Bookmark-file-1'));
 }
 await popup.close();await tab.close();await first.bringToFront();await idle(first);

 const cookies=await context.cookies();const auth=cookies.find(c=>c.name==='auth');assert(auth?.httpOnly&&auth.secure&&auth.sameSite==='Strict');
 const second=await context.newPage();await second.goto(extension+'start.html');await second.locator('#addGroup:not([disabled])').waitFor();await idle(second);
 await first.bringToFront();await idle(first);await testBookmarkTransfer({first,second,snap,idle});
 // Deep search and breadcrumb navigation; hidden items stay out of ordinary search.
 await first.bringToFront();await first.locator('#search').fill('Needle');assert.equal(await first.locator('#cards .tile-title').count(),1);assert.match(await first.locator('.tile-path').innerText(),/Daily \/ Reading \/ Deep/);await first.locator('#search').fill('');
 await first.getByRole('button',{name:'打开文件夹：Reading',exact:true}).click();await first.getByRole('button',{name:'打开文件夹：Deep',exact:true}).click();assert.equal(await first.locator('#folderTitle').innerText(),'Deep');await first.keyboard.press('Escape');
 // Draft is isolated; the server timestamp and IndexedDB stay unchanged until explicit save.
 const importedFirst=structuredClone((await snap(first)).document);importedFirst.updatedAt=9999999999999;importedFirst.roots[0].children[0].title='Draft one';await selectBookmarkFile(first,importedFirst);assert.equal((await snap(first)).document.roots[0].children[0].title,'Docs');assert.equal((await snap(first)).document.updatedAt,1);
 assert.equal(await second.locator('#cards .tile-title').first().innerText(),'Docs');
 await second.bringToFront();await editTitle(second,'Docs','Draft two');await first.bringToFront();await first.locator('#save').click();await first.locator('#draftBar').waitFor({state:'hidden'});
 const saved=await snap(first);assert.equal(saved.document.roots[0].children[0].title,'Draft one');assert(saved.document.updatedAt>1);assert.deepEqual(saved.document,JSON.parse(await env.FAV_KV.get(CURRENT_KEY)).document);
 await second.bringToFront();await second.locator('#save').click();await second.locator('#status').filter({hasText:/云端数据已变化/}).waitFor();assert(await second.locator('#draftBar').isVisible());assert.equal(await second.locator('#cards .tile-title').first().innerText(),'Draft two');
 second.once('dialog',d=>d.accept());await second.locator('#refresh').click();await idle(second);assert.equal(await second.locator('#cards .tile-title').first().innerText(),'Draft one');
 // Exact message whitelist: added query/hash, popup, content script cannot save/read full data.
 const permissions=await worker.evaluate(async()=>{const {trustedClient}=fixtureAPI;const id=chrome.runtime.id;return [trustedClient({id,url:chrome.runtime.getURL('start.html')},'save'),trustedClient({id,url:chrome.runtime.getURL('start.html?x=1')},'save'),trustedClient({id,url:chrome.runtime.getURL('start.html#x')},'save'),trustedClient({id,url:chrome.runtime.getURL('popup.html')},'save'),trustedClient({id,url:'https://example.invalid'},'cache.get')];});assert.deepEqual(permissions,[true,false,false,false,false]);
 // Native capture handler uses stable recursive targets, latest ETag, and same-container deduplication.
 await worker.evaluate(async()=>{const {readMenuIndex,handleMenuClick}=fixtureAPI;const index=await readMenuIndex();const key=Object.keys(index.entries).find(k=>index.entries[k].containerId==='Deep');await handleMenuClick({menuItemId:key,linkUrl:'https://example.invalid/captured'},{});});
 await first.bringToFront();await idle(first);let captured=await snap(first);assert.equal(captured.document.roots[0].children[1].children[0].children.at(-1).url,'https://example.invalid/captured');
 const before=captured.etag;await worker.evaluate(async()=>{const {readMenuIndex,handleMenuClick}=fixtureAPI;const index=await readMenuIndex();const key=Object.keys(index.entries).find(k=>index.entries[k].containerId==='Deep');await handleMenuClick({menuItemId:key,linkUrl:'https://example.invalid/captured'},{});});assert.equal((await snap(first)).etag,before);
 // Cache write failure cannot be reported as cloud failure or destroy the previous snapshot.
 await worker.evaluate(() => { globalThis.originalPut=IDBObjectStore.prototype.put; IDBObjectStore.prototype.put=function(...args){if(this.name==='documents') throw new DOMException('Synthetic quota failure','QuotaExceededError');return originalPut.apply(this,args);}; });
 const candidate=structuredClone(captured.document);candidate.roots[0].children[0].note='cache-write-failure';
 const cacheFailed=await rpc(first,'save',{document:candidate,baseEtag:before});assert(cacheFailed.ok&&cacheFailed.value.saved&&cacheFailed.value.warning);assert.equal((await snap(first)).etag,before);
 await worker.evaluate(() => { IDBObjectStore.prototype.put=originalPut; });await rpc(first,'sync',{force:true});captured=await snap(first);const newest=captured.etag;assert.notEqual(newest,before);
 // Corrupt cache is not interpreted as an empty successful library; authenticated refresh repairs it.
 await worker.evaluate(async site=>{const db=await new Promise(resolve=>{const r=indexedDB.open('smarttools-confirmed-cache',2);r.onsuccess=()=>resolve(r.result);});await new Promise((resolve,reject)=>{const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put({schema:2,site,document:{roots:[]}});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();},base);
 const corrupt=await rpc(first,'cache.get');assert.equal(corrupt.ok,false);assert.match(corrupt.error,/缓存格式损坏/);
 const repaired=await rpc(first,'sync',{force:true});assert(repaired.ok);assert.equal((await snap(first)).etag,newest);
 // Invalid/private-filtered server data cannot overwrite a confirmed full cache or leave writes enabled.
 mode='invalid';await first.bringToFront();await first.locator('#refresh').click();await first.locator('#status').filter({hasText:/无效/}).waitFor();assert(await first.locator('#addGroup').isDisabled());assert.equal((await snap(first)).etag,newest);
 mode='normal';await first.locator('#refresh').click();await idle(first);
 // Simulated permission guard failure: no request may reach the server; local data remains readable.
 const beforePermissionCalls=calls.length;
 await worker.evaluate(()=>{globalThis.originalContains=chrome.permissions.contains;chrome.permissions.contains=async()=>false;});
 const denied=await rpc(first,'sync',{force:true});assert.equal(denied.status,403);assert.equal(calls.length,beforePermissionCalls);assert.equal((await snap(first)).etag,newest);
 await worker.evaluate(()=>{chrome.permissions.contains=originalContains;});
 // Offline errors keep verified identity, Private cache and draft; no retry or forced logout.
 await editTitle(first,'Draft one','Offline draft');mode='offline';await first.locator('#save').click();await first.locator('#status').filter({hasText:/503/}).waitFor();assert(await first.locator('#draftBar').isVisible());assert(await first.locator('#save').isDisabled());assert.equal((await snap(first)).etag,newest);
 mode='normal';first.once('dialog',d=>d.accept());await first.locator('#refresh').click();await idle(first);
 const logoutResult=await rpc(first,'logout');assert(logoutResult.ok);await first.reload();await idle(first);assert(await first.getByRole('button',{name:'Private · Private',exact:true}).isVisible());assert(await first.locator('#addGroup').isDisabled());
 assert.equal((await rpc(first,'save',{document:fixture(),baseEtag:before})).status,401);
 for(const width of [820,390,320]) {await first.setViewportSize({width,height:700});assert(await first.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 assert(!calls.some(([,url])=>url==='/api/save'||url.startsWith('/api/data')));
 // Same browser profile restart while disconnected restores the full local copy, not auth.
 await context.close();mode='offline';context=await launch();track();const restored=await context.newPage();await restored.goto(extension+'start.html');await restored.getByRole('button',{name:'Private · Private',exact:true}).waitFor();assert(await restored.locator('#addGroup').isDisabled());
 const cleared=await rpc(restored,'cache.clear',{all:true});assert(cleared.ok);assert.equal(await snap(restored),null);
 // Old IndexedDB snapshots are never read or migrated; v2 documents remain available.
 const restarted=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const oldSite=base, otherSite='https://second.example.invalid';
 await restarted.evaluate(async({site,other,document})=>{
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('smarttools-confirmed-cache',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   await new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put({schema:1,site,privateFiltered:false,sections:[{key:'old-private',label:'Old private',private:true,cards:[]}]});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
   await fixtureAPI.writeSnapshot({schema:2,site:other,document,etag:'"other"',savedAt:1});
 },{site:oldSite,other:otherSite,document:fixture()});
 const old=await snap(restored);assert.equal(old,null);await restored.reload();await idle(restored);assert.equal(await restored.getByRole('button',{name:'Old private · Private',exact:true}).count(),0);
 await restarted.evaluate(async({site,document})=>fixtureAPI.writeSnapshot({schema:2,site,document,etag:'"upgraded"',savedAt:1}),{site:base,document:fixture()});
 assert.equal((await snap(restored)).schema,2);
 const leftover=await restarted.evaluate(async site=>{const db=await new Promise(resolve=>{const r=indexedDB.open('smarttools-confirmed-cache',2);r.onsuccess=()=>resolve(r.result);});const result=await new Promise(resolve=>{const r=db.transaction('snapshots').objectStore('snapshots').get(site);r.onsuccess=()=>resolve(r.result);});db.close();return result;},base);assert.equal(leftover,undefined);
 await rpc(restored,'cache.clear');assert.equal(await snap(restored),null);
 assert(await restarted.evaluate(async site=>!!await fixtureAPI.readSnapshot(site),otherSite));
 await restarted.evaluate(configUrl=>chrome.storage.sync.set({configUrl}),otherSite+'/config.html');
 await restored.getByRole('button',{name:'Private · Private',exact:true}).waitFor();assert(await restored.locator('#addGroup').isDisabled());
 const cross=await rpc(restored,'cache.get');assert.equal(cross.status,409); // Cannot request the former site through the configured-site RPC.
 const other=await rpc(restored,'cache.get',{configUrl:otherSite+'/config.html'});assert.equal(other.value.site,otherSite);
 await rpc(restored,'cache.clear',{all:true,configUrl:otherSite+'/config.html'});
 assert.equal(await restarted.evaluate(site=>fixtureAPI.readSnapshot(site),otherSite),null);
 assert.deepEqual(errors,[]);
 console.log('PASS real MV3: popup copy with synthetic clipboard and HTML/JSON downloads, JSON import/export/save isolation and file-read guards, Cookie login, recursive search/folders, shared confirmed cache, independent drafts/conflict, menu capture/dedupe, offline/logout/restart/clear, legacy IDB ignored and cleared, per-site isolation, invalid response/permission guards, whitelist and responsive layout');
} finally {await context.close();await new Promise(resolve=>server.close(resolve));}
