import test from 'node:test';
import assert from 'node:assert/strict';
import { withLock } from './storage.mjs';
import { createBatch, listBatches } from './batches.mjs';
import { passwordHash } from './security.mjs';
import { createHandler } from './router.mjs';
import { saveModel } from './credentials.mjs';
class Store {
  data=new Map();
  async get(k){return structuredClone(this.data.get(k)??null);}
  async set(k,v){this.data.set(k,structuredClone(v));}
  async create(k,v){if(this.data.has(k))return false;await this.set(k,v);return true;}
  async delete(k){this.data.delete(k);}
  async list(prefix){return [...this.data.keys()].filter(k=>k.startsWith(prefix));}
}
const env={GEO_ACCOUNT:'test-user',GEO_PASSWORD_HASH:await passwordHash('example-password'),GEO_MASTER_KEY:'f'.repeat(64),IMA_OPENAPI_CLIENTID:'fixture-client',IMA_OPENAPI_APIKEY:'fixture-key',APP_ORIGIN:'https://geo.test'};
test('history recovery repairs a missing summary on idempotent creation retry',async()=>{
  const store=new Store(),session={id:'test-session',expiresAt:Date.now()+86400000};
  await saveModel({provider:'kimi',slot:'secondary',apiKey:'fixture-key'},store,env,session);
  const original=store.set.bind(store);let fail=true;
  store.set=async(k,v)=>{if(fail&&k.includes('/summaries/')){fail=false;throw new Error('simulated storage outage');}return original(k,v);};
  const payload={requestId:crypto.randomUUID(),rows:[['品牌名','GEO知识库','问句'],['品牌','品牌库','问句']],companies:[{name:'公司.md',brand:'品牌',text:'公司原文'}]};
  await assert.rejects(createBatch(payload,store,env,session),/storage outage/);
  const retry=await createBatch(payload,store,env,session);
  const history=await listBatches(store,session);assert.equal(history.length,1);assert.equal(history[0].id,retry.id);
});
test('expired lease recovers without deleting a newer holder',async()=>{
  const store=new Store();
  const first=withLock(store,'rotate',async()=>{
    for(const [k,v] of store.data) if(v&&v.at)store.data.set(k,{...v,at:Date.now()-200000});
    await withLock(store,'rotate',async()=>{});
  });
  await first;
  assert.equal(await withLock(store,'rotate',async()=>42),42);
});
test('failed release does not convert successful action to failure or leave permanent lock',async()=>{
  const store=new Store();
  store.delete=async()=>{throw new Error('delete outage');};
  assert.equal(await withLock(store,'save',async()=>42),42);
  assert.equal(await withLock(store,'save',async()=>43),43);
});
test('one client login failures do not block another client with the correct password',async()=>{
  const store=new Store();
  const handler=createHandler({store,env});
  const call=async(ip,password)=>handler(new Request(env.APP_ORIGIN+'/api/auth/login',{method:'POST',headers:{origin:env.APP_ORIGIN,'content-type':'application/json','eo-connecting-ip':'untrusted-client-header'},body:JSON.stringify({account:env.GEO_ACCOUNT,password})}),{clientIp:ip});
  for(let n=0;n<5;n++)assert.equal((await call('192.0.2.1','wrong')).status,401);
  assert.equal((await call('192.0.2.1','wrong')).status,429);
  assert.equal((await call('192.0.2.2','example-password')).status,200);
});
