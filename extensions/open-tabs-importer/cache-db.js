import { validateDocument } from './bookmark-document.js';
// Extension-origin IndexedDB only. Never exposed to content scripts or website origins.
const DB_NAME = 'smarttools-confirmed-cache';
let opening;
function openDatabase() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('snapshots')) request.result.createObjectStore('snapshots', { keyPath: 'site' });
      request.result.createObjectStore('documents', { keyPath: 'site' });
      if (!request.result.objectStoreNames.contains('internal')) request.result.createObjectStore('internal');
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    request.onerror = () => { opening = null; reject(new Error('无法打开本机缓存')); };
  });
  return opening;
}
async function transaction(store, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let request;
    try { request = operation(tx.objectStore(store)); } catch (error) { tx.abort(); reject(error); return; }
    tx.oncomplete = () => resolve(request?.result);
    tx.onabort = tx.onerror = () => reject(new Error('本机缓存读写失败；原缓存未被替换，请检查存储空间'));
  });
}
export function validSnapshot(value, site) {
  try { validateDocument(value?.document); return value.schema === 2 && value.site === site && typeof value.etag === 'string' && !!value.etag && Number.isFinite(value.savedAt); } catch { return false; }
}
export async function readSnapshot(site) {
  const value = await transaction('documents', 'readonly', store => store.get(site));
  if (value === undefined) {
    const legacy = await transaction('snapshots', 'readonly', store => store.get(site));
    if (!legacy) return null;
    if (legacy.schema !== 1 || legacy.site !== site || legacy.privateFiltered !== false || !Array.isArray(legacy.sections)) throw new Error('旧版本机缓存损坏，请联网刷新或清除');
    return { ...legacy, legacy: true }; // Only read-only conversion in the page; never uploaded.
  }
  if (!validSnapshot(value, site)) throw new Error('本机缓存格式损坏，请联网刷新或清除缓存');
  return value;
}
export async function writeSnapshot(snapshot) {
  if (!validSnapshot(snapshot, snapshot.site)) throw new Error('拒绝缓存未经确认或无效的文档');
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['documents', 'snapshots'], 'readwrite');
    tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(new Error('本机缓存写入失败，旧快照保留'));
    try { tx.objectStore('documents').put(snapshot); tx.objectStore('snapshots').delete(snapshot.site); }
    catch (error) { tx.abort(); reject(error); }
  });
}
export async function clearSnapshots(site) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    // Menu fingerprints may contain card content too: erase them in the same transaction.
    const tx = db.transaction(['documents', 'snapshots', 'internal'], 'readwrite');
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(new Error('清除本机缓存失败；请重试'));
    const documents = tx.objectStore('documents');
    if (site) documents.delete(site); else documents.clear();
    const snapshots = tx.objectStore('snapshots');
    if (site) snapshots.delete(site); else snapshots.clear();
    const internal = tx.objectStore('internal');
    if (!site) internal.clear();
    else {
      const index = internal.get('menus');
      index.onsuccess = () => { if (index.result?.site === site) internal.delete('menus'); };
    }
  });
}
export const readMenuIndex = () => transaction('internal', 'readonly', store => store.get('menus'));
export const writeMenuIndex = value => transaction('internal', 'readwrite', store => store.put(value, 'menus'));
