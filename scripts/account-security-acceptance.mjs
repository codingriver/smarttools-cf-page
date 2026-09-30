import assert from 'node:assert/strict';
import { onRequestPost as login } from '../functions/api/v2/auth/login.js';
import { onRequestGet as check } from '../functions/api/v2/auth/session.js';
import { onRequestPost as logout } from '../functions/api/v2/auth/logout.js';
import { credentials, session, createSessionToken, requireV2Auth } from '../functions/_shared/auth-v2.js';
import { createToken } from '../functions/_shared/auth.js';
import { onRequest as middleware } from '../functions/_middleware.js';
const SECRET = '0123456789abcdef0123456789abcdef';
const env = { FAV_KV: new Map(), AUTH_SECRET: SECRET };
// In-memory KV simulates best-effort lockouts and retains intentionally corrupted legacy credentials.
const records = new Map();
env.FAV_KV = {
  async getWithMetadata(key) { return { value: records.get(key)?.value || null, metadata: records.get(key)?.metadata || null }; },
  async put(key, value, opts) { records.set(key, {value, metadata:opts?.metadata}); },
  async delete(key) { records.delete(key); },
  async get(key) { return records.get(key)?.value || null; }
};
const invoke = async (handler, method, path, body, cookie, config = env, ip = 'test-ip') => {
  const headers = { 'CF-Connecting-IP': ip, ...(cookie ? {Cookie:cookie} : {}), ...(body === undefined ? {} : {'Content-Type':'application/json'}) };
  const request = new Request('https://test.invalid' + path, {method,headers,...(body === undefined ? {} : {body:JSON.stringify(body)})});
  return handler({request,env:config});
};
const signIn = (body, config = env, ip) => invoke(login,'POST','/api/v2/auth/login',body,null,config,ip);
assert.deepEqual(credentials(env), {user:'admin',password:'codingriver2026',secret:SECRET,usesDefaultPassword:true});
assert.equal((await invoke(check,'GET','/api/v2/auth/session')).status,200);
const anonymous = await (await invoke(check,'GET','/api/v2/auth/session')).json();
assert.equal(anonymous.loggedIn,false);assert.equal(anonymous.configured,true);assert(!Object.hasOwn(anonymous,'usesDefaultPassword'));
for(const config of [ {USER:''}, {PASSWORD:''}, {USER:7}, {PASSWORD:7}, {AUTH_SECRET:'short'} ]) {
 const value={...env,...config};
 assert.equal((await signIn({username:'admin',password:'codingriver2026'},value)).status,503);
 assert.equal((await (await invoke(check,'GET','/api/v2/auth/session',undefined,null,value)).json()).configured,false);
 assert.equal((await requireV2Auth(new Request('https://test.invalid/api/v2/bookmarks'),value)).status,503);
}
assert.equal((await signIn({username:'admin'})).status,400);
assert.equal((await signIn({username:'admin',password:'bad'})).status,401);
const successful=await signIn({username:'admin',password:'codingriver2026'});
assert.equal(successful.status,200);assert.equal(successful.headers.get('Cache-Control'),'private, no-store');
const setCookie=successful.headers.get('Set-Cookie');for(const flag of ['HttpOnly','Secure','SameSite=Strict','Max-Age=604800'])assert(setCookie.includes(flag));
const cookie=setCookie.split(';')[0];
const authenticated=await (await invoke(check,'GET','/api/v2/auth/session',undefined,cookie)).json();
assert.equal(authenticated.loggedIn,true);assert.equal(authenticated.usesDefaultPassword,true);
assert.equal((await requireV2Auth(new Request('https://test.invalid/api/v2/bookmarks',{headers:{Cookie:cookie}}),env)),null);
const renamed={...env,USER:'new-user'};const updated={...env,PASSWORD:'different-password'};
const rotated={...env,AUTH_SECRET:'another-secret-0123456789abcdef'};
for(const config of [renamed,updated,rotated]) assert.equal(await session(new Request('https://test.invalid',{headers:{Cookie:cookie}}),config),null);
assert.equal((await signIn({username:'new-user',password:'codingriver2026'},renamed)).status,200);
assert.equal((await signIn({username:'admin',password:'different-password'},updated)).status,200);
assert.equal((await (await invoke(check,'GET','/api/v2/auth/session',undefined,(await signIn({username:'admin',password:'different-password'},updated)).headers.get('Set-Cookie').split(';')[0],updated)).json()).usesDefaultPassword,false);
const legacyCookie='auth=' + await createToken('admin',SECRET);
assert.equal(await session(new Request('https://test.invalid',{headers:{Cookie:legacyCookie}}),env),null);
records.set('admin:credentials',{value:'not valid JSON'});
assert.equal((await signIn({username:'admin',password:'codingriver2026'})).status,200);
const extra={...env,ADMIN_USER:'someone-else',ADMIN_PASS:'ignored'};
assert.equal((await signIn({username:'admin',password:'codingriver2026'},extra)).status,200);
for(let i=0;i<5;i++)assert.equal((await signIn({username:'bad',password:'bad'},env,'locked-ip')).status,401);
assert.equal((await signIn({username:'admin',password:'codingriver2026'},env,'locked-ip')).status,429);
for(let i=0;i<2;i++) {const out=await invoke(logout,'POST','/api/v2/auth/logout');assert.equal(out.status,200);assert(out.headers.get('Set-Cookie').includes('Max-Age=0'));}
assert.equal(await session(new Request('https://test.invalid',{headers:{Cookie:'auth=' + await createSessionToken(env)}}),env) !== null,true);
for(const mode of ['legacy','maintenance','v2']){
 const target={...env,BOOKMARKS_MODE:mode};
 for(const path of ['/api/login','/api/check','/api/logout','/api/account/security','/api/account/change-password','/api/account/recovery']){
  for(const suffix of ['', '/']){const response=await middleware({request:new Request('https://test.invalid'+path+suffix,{method:'POST'}),env:target,next:()=>{throw Error('Retired route reached handler');}});assert.equal(response.status,410);assert.equal((await response.json()).code,'AUTH_PROTOCOL_RETIRED');}
 }
 for(const path of ['/api/change-password','/api/does-not-exist']){
  const response=await middleware({request:new Request('https://test.invalid'+path),env:target,next:()=>new Response(JSON.stringify({ok:false,error:'not found'}),{status:404,headers:{'Content-Type':'application/json'}})});
  assert.equal(response.status,404);assert.match(response.headers.get('Content-Type'),/json/);
 }
}
console.log('PASS v2 default/overridden credentials, session rotation, legacy isolation, throttling, cookie safety and retired routes');
