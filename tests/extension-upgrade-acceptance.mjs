import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

// Synthetic upgrade: the former extension registered a persistent content script.
// Verify dropping scripting permission and the script file does not leave it active.
const server = http.createServer((_req, res) => res.writeHead(200, {'Content-Type':'text/html'}).end('<!doctype html><title>Synthetic page</title>'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
await mkdir('.wrangler', {recursive:true});
const directory = await mkdtemp(path.resolve('.wrangler/extension-upgrade-'));
const staged = path.join(directory,'extension');
const profile = path.join(directory,'profile');
let context;
try {
  await cp('extensions/open-tabs-importer', staged, {recursive:true});
  const manifestPath=path.join(staged,'manifest.json');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  manifest.permissions.push('scripting');
  manifest.host_permissions=[url+'*'];
  manifest.version='1.1.9';
  await writeFile(manifestPath,JSON.stringify(manifest));
  await writeFile(path.join(staged,'pending-import.js'), `document.documentElement.dataset.qiyeOldInjection='yes';`);
  const launch=()=>chromium.launchPersistentContext(profile,{executablePath:process.env.EXTENSION_CHROME_PATH||chromium.executablePath(),headless:true,args:[`--disable-extensions-except=${staged}`,`--load-extension=${staged}`]});
  context=await launch();
  let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  await worker.evaluate(async()=>{
    await chrome.scripting.registerContentScripts([{id:'smarttools-pending',js:['pending-import.js'],matches:['http://127.0.0.1/*'],persistAcrossSessions:true}]);
  });
  let page=await context.newPage();await page.goto(url);
  assert.equal(await page.locator('html').getAttribute('data-qiye-old-injection'),'yes','Synthetic old script did not register');
  await context.close();context=null;
  manifest.permissions=manifest.permissions.filter(p=>p!=='scripting');
  delete manifest.host_permissions;
  manifest.version='1.2.0';
  await writeFile(manifestPath,JSON.stringify(manifest));
  await rm(path.join(staged,'pending-import.js'));
  context=await launch();
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  assert.equal(new URL(worker.url()).host,id,'Profile did not preserve extension identity');
  page=await context.newPage();await page.goto(url);await page.waitForTimeout(500);
  assert.equal(await page.locator('html').getAttribute('data-qiye-old-injection'),null,'Legacy persistent injection survived upgrade');
  console.log('PASS synthetic MV3 upgrade: old persistent content script no longer injects after permission and file removal');
} finally {await context?.close();await new Promise(resolve=>server.close(resolve));}
