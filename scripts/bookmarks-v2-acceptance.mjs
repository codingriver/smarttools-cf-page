import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateDocument, businessContent, entries, moveNode, canMoveNode } from '../extensions/open-tabs-importer/bookmark-document.js';
import { prepareCandidate } from './prepare-bookmarks-v2.mjs';
import { fixture, folder, bookmark, testEnv } from './bookmarks-v2-fixture.mjs';
import { handleBookmarks, CURRENT_KEY } from '../functions/_shared/bookmarks-v2.js';
import { createSessionToken } from '../functions/_shared/auth-v2.js';
import { onRequestPost as authLogin } from '../functions/api/v2/auth/login.js';
import { onRequestGet as authSession } from '../functions/api/v2/auth/session.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { menuTargets, appendCapture, resolveTarget, captureItem } from '../extensions/open-tabs-importer/menu-model.js';
const env = testEnv(), original = { document:fixture(), etag:'"initial"' };
env.FAV_KV.data.set(CURRENT_KEY, JSON.stringify(original));
const historicalKey = 'admin:bookmarks:v2:backup:historical';
const historicalValue = JSON.stringify({synthetic: 'untouched'});
env.FAV_KV.data.set(historicalKey, historicalValue);
env.FAV_KV.list = async () => { throw Error('Must not enumerate historical backups'); };
env.FAV_KV.delete = async () => { throw Error('Must not delete historical backups'); };
const token = await createSessionToken(env);
const publicDefaults = { AUTH_SECRET: env.AUTH_SECRET, FAV_KV: testEnv().FAV_KV };
const authPath = 'https://example.invalid/api/v2/auth/login';
const attempt = (config, username, password) => authLogin({ env: config, request: new Request(authPath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }) });
assert.equal((await attempt({ ...publicDefaults, PASSWORD: '' }, 'admin', 'codingriver2026')).status, 503);
assert.equal((await attempt({ FAV_KV: publicDefaults.FAV_KV }, 'admin', 'codingriver2026')).status, 503);
assert.equal((await attempt(publicDefaults, 'admin', 'incorrect')).status, 401);
const defaultLogin = await attempt(publicDefaults, 'admin', 'codingriver2026');
assert.equal(defaultLogin.status, 200);
const sessionCookie = defaultLogin.headers.get('Set-Cookie');
assert.match(sessionCookie, /HttpOnly/); assert.match(sessionCookie, /Secure/); assert.match(sessionCookie, /SameSite=Strict/);
const defaultCookie = new Request('https://example.invalid/api/v2/auth/session', { headers: { Cookie: sessionCookie.split(';')[0] } });
const anonymous = await (await authSession({ env: publicDefaults, request: new Request(defaultCookie.url) })).json();
assert.equal(anonymous.loggedIn, false); assert.equal('usesDefaultPassword' in anonymous, false);
const signedIn = await (await authSession({ env: publicDefaults, request: defaultCookie })).json();
assert.equal(signedIn.usesDefaultPassword, true); assert.equal(signedIn.username, 'admin');
for (const changed of [{ USER: 'other' }, { PASSWORD: 'unique' }, { AUTH_SECRET: env.AUTH_SECRET + '-changed' }]) {
  const check = await authSession({ env: { ...publicDefaults, ...changed }, request: defaultCookie });
  assert.equal(check.status, 200); assert.equal((await check.json()).loggedIn, false);
}

const call = (method='GET', body, auth=true, meta=false) => handleBookmarks({env, request:new Request('https://example.invalid/api/v2/bookmarks', {method,headers:auth?{Cookie:'auth='+token}:{},...(body===undefined?{}:{body:JSON.stringify(body)})})},meta);
assert.equal((await call('GET',undefined,false)).status,401);
assert.equal((await call()).headers.get('Cache-Control'),'private, no-store');
assert.deepEqual((await (await call()).json()).document, fixture());
assert.equal((await (await call('GET',undefined,true,true)).json()).etag, original.etag);
assert.equal((await call('PUT',{document:fixture()})).status,428);
assert.equal((await call('PUT',{document:fixture(),baseEtag:'stale'})).status,409);
let doc=fixture();doc.updatedAt=999999999999999;
let result=await (await call('PUT',{document:doc,baseEtag:original.etag})).json();
assert(result.unchanged);assert.equal(result.document.updatedAt,1);assert.equal(env.FAV_KV.writes.length,0);
doc.roots[0].title='Renamed';result=await (await call('PUT',{document:doc,baseEtag:original.etag})).json();
assert.equal(result.document.roots[0].title,'Renamed');assert(result.document.updatedAt>1&&result.document.updatedAt<999999999999999);
assert.equal(env.FAV_KV.writes.length,1);assert.equal(env.FAV_KV.writes[0],CURRENT_KEY);assert.equal(env.FAV_KV.data.get(historicalKey),historicalValue);
assert.equal((await call('PUT',{document:doc,baseEtag:original.etag})).status,409);
assert((await (await call('PUT',{document:doc,baseEtag:result.meta.etag})).json()).unchanged);
doc.roots[0].title='Again';assert.equal((await call('PUT',{document:doc,baseEtag:result.meta.etag})).status,429);
env.FAV_KV.data.set(CURRENT_KEY,JSON.stringify(original));
env.FAV_KV.fail=key=>key===CURRENT_KEY;assert((await (await call('PUT',{document:doc,baseEtag:original.etag})).json()).outcomeUnknown);env.FAV_KV.fail=null;
env.FAV_KV.data.set(CURRENT_KEY,JSON.stringify({document:{schemaVersion:2,roots:[]},etag:'"broken"'}));assert.equal((await call()).status,503);env.FAV_KV.data.set(CURRENT_KEY,JSON.stringify(original));
for(const mutate of [d=>d.roots[0].children.push(bookmark('Docs')),d=>d.roots[0].updatedAt=2,d=>d.roots[0].children[0].url='javascript:alert(1)',d=>d.roots.push(bookmark('root')),d=>d.roots[0].children[0].isPrivate=true]) {doc=fixture();mutate(doc);assert.throws(()=>validateDocument(doc));}
doc=fixture();let child=doc.roots[0];for(let i=0;i<32;i++){const next=folder('level'+i);child.children.push(next);child=next;}assert.throws(()=>validateDocument(doc));
doc=fixture();assert(!canMoveNode(doc,'Reading','Deep'));assert(moveNode(doc,'Needle','Work'));assert.equal(doc.updatedAt,1);assert.equal(entries(doc).find(e=>e.node.id==='Needle').parent.id,'Work');
assert(!moveNode(doc,'Local secret','Work',null,()=>false));assert(moveNode(doc,'Local secret','Work',null,()=>true));assert(!entries(doc).find(e=>e.node.id==='Local secret').isPrivate);
assert(businessContent({...doc,updatedAt:100})===businessContent({...doc,updatedAt:200}));
const candidate=prepareCandidate(fixture());assert.deepEqual(candidate.document,fixture());assert.match(candidate.etag,/^"[^"\r\n]+"$/);
assert.throws(()=>prepareCandidate({sections:[]}));
doc=fixture();const targets=menuTargets({document:doc});const target=targets.find(t=>t.id==='Deep').entries[0].target;
assert(appendCapture(doc,target,{url:'https://example.invalid/new',title:'New'},'https://example.invalid','new'));assert(!appendCapture(doc,target,{url:'https://example.invalid/new',title:'New'},'https://example.invalid','another'));
doc.roots[0].isPrivate=true;assert.throws(()=>resolveTarget(doc,target));assert.throws(()=>captureItem({}, {url:'chrome://extensions'}));
for (const route of ['/api/save','/api/login','/api/check','/config.html','/','/api/v2/bookmarks/','/README.md']) {
 const response=await middleware({env,request:new Request('https://example.invalid'+route),next:()=>new Response('allowed')});
 assert.equal(response.status,404,route);assert.equal(response.headers.get('Content-Type')?.startsWith('application/json'),true);
}
for (const route of ['/api/v2/auth/login','/api/v2/auth/logout','/api/v2/auth/session','/api/v2/bookmarks','/api/v2/bookmarks/meta']) {
 const response=await middleware({env,request:new Request('https://example.invalid'+route,{method:'PATCH'}),next:()=>new Response('allowed')});
 assert.equal(response.status,405,route);
}
assert.equal((await middleware({env,request:new Request('https://example.invalid/api/v2/bookmarks'),next:()=>new Response('allowed')})).status,200);
console.log('PASS v2 document validation, single-key save, no-op, ETag, auth and closed routes');
const temporary=await mkdtemp(path.join(tmpdir(),'qiye-init-'));
const inputPath=path.join(temporary,'input.json');await writeFile(inputPath,JSON.stringify(fixture()));
const cli=(...args)=>spawnSync(process.execPath,['scripts/prepare-bookmarks-v2.mjs',...args],{encoding:'utf8'});
for(const [name,args,expected] of [['empty',['--empty','--output',path.join(temporary,'empty')],0],['v2',['--input',inputPath,'--output',path.join(temporary,'v2')],fixture().updatedAt]]){
 const result=cli(...args);assert.equal(result.status,0,result.stderr);assert(!result.stdout.includes('https://'));const value=JSON.parse(await readFile(path.join(temporary,name,'candidate.json'),'utf8'));validateDocument(value.document);assert.equal(value.document.updatedAt,expected);assert.equal(value.etag.startsWith('"'),true);
 assert.notEqual(cli(...args).status,0);assert.deepEqual(await (await import('node:fs/promises')).readdir(path.join(temporary,name)),['candidate.json']);
}
await writeFile(inputPath,JSON.stringify({sections:[]}));assert.notEqual(cli('--input',inputPath,'--output',path.join(temporary,'invalid')).status,0);
assert.notEqual(cli('--empty','--output',path.resolve('.wrangler/forbidden-candidate')).status,0);
console.log('PASS offline v2 initializer: valid schema, external output, no overwrite, no legacy input');
