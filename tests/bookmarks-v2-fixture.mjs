// Synthetic data only. Never point these tests at production.
export const folder = (id, children = [], extra = {}) => ({ id, type:'folder', title:id, isPrivate:false, visible:true, children, ...extra });
export const bookmark = id => ({ id, type:'bookmark', title:id, url:'https://example.invalid/' + id });
export const fixture = () => ({ schemaVersion:2, updatedAt:1, roots:[
  folder('Daily', [bookmark('Docs'), folder('Reading', [folder('Deep', [bookmark('Needle')]), bookmark('Child')]), { id:'special', type:'legacy', title:'Special', extensions:{legacyData:{type:'counter', arbitrary:42}} }]),
  folder('Work'), folder('Private', [bookmark('Local secret')], { isPrivate:true }), folder('Hidden', [bookmark('Hidden needle')], {visible:false})
] });
export class MemoryKV {
  data = new Map(); writes = []; fail = null;
  async get(key, options) { const value = this.data.get(key) ?? null; return options === 'json' || options?.type === 'json' ? value === null ? null : JSON.parse(value) : value; }
  async put(key, value) { if (this.fail?.(key)) throw Error('Synthetic KV failure'); this.writes.push(key); this.data.set(key,value); }
  async delete(key) { this.data.delete(key); }
  async list({prefix}) { return {keys:[...this.data.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true}; }
}
export const testEnv = () => ({ FAV_KV:new MemoryKV(), USER:'testadmin', PASSWORD:'TestPass2026', AUTH_SECRET:'0123456789abcdef0123456789abcdef' });
