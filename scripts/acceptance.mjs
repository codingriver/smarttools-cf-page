import assert from 'node:assert/strict';
// Isolated local Pages only: this test deliberately exercises no production endpoint.
const base = process.env.SMARTTOOLS_BASE_URL || 'http://127.0.0.1:8788';
const host = new URL(base);
assert(['localhost','127.0.0.1','[::1]'].includes(host.hostname), 'API acceptance must use a loopback server');
const username = process.env.SMARTTOOLS_TEST_USER || 'testadmin';
const password = process.env.SMARTTOOLS_TEST_PASS || 'TestPass2026';
async function call(path, method='GET', body, cookie) {
  const response = await fetch(base+path, { method, headers:{...(cookie?{Cookie:cookie}:{}),...(body === undefined?{}:{'Content-Type':'application/json'})},...(body === undefined?{}:{body:JSON.stringify(body)}) });
  assert.match(response.headers.get('Content-Type') || '', /json/, `non-JSON response: ${path}`);
  return {response,body:await response.json()};
}
const anon=await call('/api/v2/auth/session');assert.equal(anon.response.status,200);assert.equal(anon.body.loggedIn,false);assert(!Object.hasOwn(anon.body,'usesDefaultPassword'));
const bad=await call('/api/v2/auth/login','POST',{username,password:'wrong-password'});assert.equal(bad.response.status,401);
const authenticated=await call('/api/v2/auth/login','POST',{username,password});assert.equal(authenticated.response.status,200);
const setCookie=authenticated.response.headers.get('Set-Cookie');assert(setCookie?.includes('HttpOnly')&&setCookie.includes('Secure')&&setCookie.includes('SameSite=Strict'));
const cookie=setCookie.split(';')[0];const session=await call('/api/v2/auth/session','GET',undefined,cookie);assert.equal(session.body.loggedIn,true);assert.equal(session.body.usesDefaultPassword,false);
assert.equal((await call('/api/v2/bookmarks')).response.status,401);
const current=await call('/api/v2/bookmarks','GET',undefined,cookie);
assert([200,409].includes(current.response.status));assert.equal(current.response.headers.get('Cache-Control'),'private, no-store');
for(const path of ['/api/login','/api/check','/api/logout','/api/account/security','/api/account/change-password','/api/account/recovery']){
  for(const suffix of ['', '/']){const result=await call(path+suffix);assert.equal(result.response.status,410);assert.equal(result.body.code,'AUTH_PROTOCOL_RETIRED');}
}
for(const [path,method] of [['/api/v2/auth/login','GET'],['/api/v2/auth/session','POST'],['/api/v2/auth/logout','GET']]) {
  const result=await call(path,method,method==='POST'?{}:undefined);assert.equal(result.response.status,405);assert.match(result.response.headers.get('content-type')||'',/json/);
}
for(const path of ['/api/change-password','/api/unknown-route']) assert.equal((await call(path)).response.status,404);
const logout=await call('/api/v2/auth/logout','POST',{});assert.equal(logout.response.status,200);
assert.equal((await call('/api/v2/auth/session','GET',undefined,logout.response.headers.get('set-cookie').split(';')[0])).body.loggedIn,false);
console.log('PASS isolated v2 Pages authentication, signed session, bookmark denial, retired account routes and JSON 404');
