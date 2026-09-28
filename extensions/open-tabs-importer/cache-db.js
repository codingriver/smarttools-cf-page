// Extension-origin IndexedDB only. Never exposed to content scripts or website origins.
const DB_NAME = 'smarttools-confirmed-cache';
let opening;
function openDatabase() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('snapshots', { keyPath: 'site' });
      request.result.createObjectStore('internal');
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
  const keys = new Set();
  const cardsValid = (cards, depth = 0) => depth <= 10 && Array.isArray(cards) && cards.every(card =>
    card && typeof card === 'object' && !Array.isArray(card) && (card.subCards === undefined || cardsValid(card.subCards, depth + 1)));
  return value?.schema === 1 && value.site === site && value.privateFiltered === false
    && typeof value.dataEtag === 'string' && value.dataEtag.length > 0 && Number.isFinite(value.savedAt)
    && Array.isArray(value.sections) && value.sections.every(section => {
      if (!section || typeof section.key !== 'string' || !section.key || keys.has(section.key) || !cardsValid(section.cards)) return false;
      keys.add(section.key); return true;
    });
}
export async function readSnapshot(site) {
  const value = await transaction('snapshots', 'readonly', store => store.get(site));
  if (value === undefined) return null;
  if (!validSnapshot(value, site)) throw new Error('本机缓存格式损坏，请联网刷新或清除缓存');
  return value;
}
export async function writeSnapshot(snapshot) {
  if (!validSnapshot(snapshot, snapshot.site)) throw new Error('拒绝缓存非管理员确认的数据');
  await transaction('snapshots', 'readwrite', store => store.put(snapshot));
}
export async function clearSnapshots(site) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    // Menu fingerprints may contain card content too: erase them in the same transaction.
    const tx = db.transaction(['snapshots', 'internal'], 'readwrite');
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(new Error('清除本机缓存失败；请重试'));
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
