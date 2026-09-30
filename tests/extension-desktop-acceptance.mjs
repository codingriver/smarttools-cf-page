import assert from 'node:assert/strict';
import { authorizeSite } from '../extensions/qiye/site.js';
import { client, applyClientError, sessionLabel } from '../extensions/qiye/client.js';
import { saveDraft } from '../extensions/qiye/draft-actions.js';
import { createEditing } from '../extensions/qiye/library-editing.js';
import { fixture } from './bookmarks-v2-fixture.mjs';
let form, dirty=0;
const state={document:fixture(),selected:'Daily'};
const edit=createEditing({state,dialog:(...args)=>form=args,changed:()=>dirty++});
globalThis.confirm=()=>true;
edit.editGroup();form[2]({title:'Created',visible:true,isPrivate:false});const created=state.document.roots.at(-1);
edit.editCard(created,null,null,true);form[2]({title:'Folder',visible:true,isPrivate:false});const folder=created.children[0];
edit.editCard(created,null,folder);form[2]({title:'Child',url:'https://example.invalid/child'});
edit.deleteCard(created,folder);form[2]({target:created.id});assert.equal(created.children[0].title,'Child');
edit.deleteGroup(created);form[2]({target:'Work'});assert(!state.document.roots.includes(created));assert.equal(state.document.roots[1].children[0].title,'Child');
// Nested folders can become root categories and root categories can move into containers.
const daily=state.document.roots.find(n=>n.id==='Daily'), reading=daily.children.find(n=>n.id==='Reading');
edit.moveCard(daily,reading);assert(form[1][0].options.some(([value])=>value===''));form[2]({target:''});assert(state.document.roots.includes(reading));assert.equal(reading.id,'Reading');
edit.moveCard(reading,reading);form[2]({target:'Daily'});assert(daily.children.includes(reading));assert(!state.document.roots.includes(reading));
// Cancelling inherited-Private release must leave the entire document unchanged.
const secret=state.document.roots.find(n=>n.id==='Private').children[0], unchanged=JSON.stringify(state.document);
globalThis.confirm=()=>false;edit.moveCard(null,secret);assert.equal(form[2]({target:'Work'}),false);assert.equal(JSON.stringify(state.document),unchanged);globalThis.confirm=()=>true;
const writable={loggedIn:true,hasKV:true,dirty:true,etag:'version',document:state.document};
let writes=0;await saveDraft(writable,async(action,payload)=>{writes++;assert.equal(action,'save');assert.equal(payload.baseEtag,'version');assert.equal(payload.document.schemaVersion,2);});
await assert.rejects(saveDraft({...writable,loggedIn:false},()=>writes++));
await assert.rejects(saveDraft(writable,()=>{writes++;throw Error('409');}),/409/);assert.equal(writes,2);assert(writable.dirty);
for(const error of [{status:0},{status:403},{status:503,outcomeUnknown:true},{status:200,code:'INVALID_RESPONSE'}]) {const state={...writable,connectionIssue:''};applyClientError(state,{...error,message:'Synthetic failure'});assert(state.loggedIn&&state.connectionIssue);assert.match(sessionLabel(state),/上次验证/);await assert.rejects(saveDraft(state,()=>writes++));}
const expired={...writable};applyClientError(expired,{status:401});assert(!expired.loggedIn);
// Worker disconnects and missing replies leave write outcomes unknown, not logged out.
for (const sendMessage of [async () => undefined, async () => { throw new Error('Synthetic disconnect'); }]) {
  globalThis.chrome = { runtime: { sendMessage } };
  await assert.rejects(client('save', 'https://example.invalid/config.html'), error => error.status === 0 && error.code === 'BACKGROUND_UNAVAILABLE' && error.outcomeUnknown === true);
}
// Saving a site must not mutate settings or imports until permission is granted.
for (const outcome of ['granted', 'denied', 'error']) {
  const oldUrl = 'https://old.example.invalid/config.html';
  const newUrl = 'https://new.example.invalid/';
  let savedUrl = oldUrl, settle;
  const events = [];
  globalThis.chrome = {
    permissions: { request: ({ origins }) => {
      events.push('permission');
      assert.deepEqual(origins, ['https://new.example.invalid/*']);
      return new Promise((resolve, reject) => { settle = () => outcome === 'error' ? reject(new Error('Synthetic permission error')) : resolve(outcome === 'granted'); });
    } },
    storage: {
      sync: { get: async () => { events.push('read'); return { configUrl: savedUrl }; }, set: async data => { events.push('save'); savedUrl = data.configUrl; } },
    },
    runtime: {}
  };
  const saving = authorizeSite(newUrl);
  assert.deepEqual(events, ['permission'], 'permission requested immediately; storage untouched while awaiting consent');
  assert.equal(savedUrl, oldUrl);
  settle();
  if (outcome === 'granted') {
    assert.equal(await saving, newUrl); assert.equal(savedUrl, newUrl);

    assert.deepEqual(events, ['permission', 'read', 'save']);
  } else {
    await assert.rejects(saving, outcome === 'error' ? /Synthetic permission error/ : /地址未保存/);
    assert.equal(savedUrl, oldUrl);
    assert.deepEqual(events, ['permission']);
  }
}
delete globalThis.chrome;
console.log('PASS unified desktop CRUD, save guards, auth distinction and permission-before-address-save');
