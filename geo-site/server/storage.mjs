import { HttpError, token } from './security.mjs';

export class JsonStore {
  constructor(blob) { this.blob = blob; }
  async get(key) { return this.blob.get(key, { type: 'json', consistency: 'strong' }); }
  async set(key, value) { await this.blob.setJSON(key, value, { cacheControl: 'no-store' }); }
  async create(key, value) {
    try { await this.blob.setJSON(key, value, { onlyIfNew: true, cacheControl: 'no-store' }); return true; }
    catch (error) { if (error.code === 'PRECONDITION_FAILED') return false; throw error; }
  }
  async delete(key) { await this.blob.delete(key); }
  async list(prefix) { const { blobs } = await this.blob.list({ prefix, consistency: 'strong', limit: 500 }); return blobs.map(x => x.key); }
}
export async function withLock(store, key, action) {
  // Immutable lease chain: no compare-and-delete race, even after timeout recovery.
  // 150 s exceeds the deployment's hard 120 s execution limit.
  let cursor=(await store.get(key+'/head'))?.lease || key+'/leases/root';
  for(let hops=0;hops<64;hops++) {
    const lease=await store.get(cursor);
    if(lease) {
      if(!await store.get(cursor+'/released') && Date.now()-lease.at<150000)throw new HttpError(409,'正在处理，请等待当前操作结束。','BUSY');
      cursor=key+'/leases/'+lease.id;continue;
    }
    if(!await store.create(cursor,{id:token(),at:Date.now()}))throw new HttpError(409,'正在处理，请等待当前操作结束。','BUSY');
    try {await store.set(key+'/head',{lease:cursor});return await action();}
    finally {
      // A release failure must not turn an already-saved update into a reported failure.
      // The lease expires safely; never remove another holder's lease.
      try {await store.create(cursor+'/released',{at:Date.now()});}catch{}
    }
  }
  throw new HttpError(503,'状态存储恢复链过长，请管理员检查存储服务。');
}
export async function makeProductionStore() {
  const { getStore } = await import('@edgeone/pages-blob');
  return new JsonStore(getStore({ name: 'lxue-geo-private', consistency: 'strong' }));
}
