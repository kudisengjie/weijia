import { HttpError } from './security.mjs';

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
  if (!await store.create(key, { at: Date.now() })) throw new HttpError(409, '正在处理，请等待当前操作结束。', 'BUSY');
  try { return await action(); } finally { await store.delete(key); }
}
export async function makeProductionStore() {
  const { getStore } = await import('@edgeone/pages-blob');
  return new JsonStore(getStore({ name: 'lxue-geo-private', consistency: 'strong' }));
}
