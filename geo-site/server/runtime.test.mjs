import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { passwordHash, seal, unseal } from './security.mjs';
import { complete, modelSelection } from './providers.mjs';

const router = existsSync(new URL('./router.mjs', import.meta.url)) ? await import('./router.mjs') : {};
class MemoryStore {
  values = new Map();
  async get(k) { return structuredClone(this.values.get(k) ?? null); }
  async set(k,v) { this.values.set(k,structuredClone(v)); }
  async create(k,v) { if(this.values.has(k)) return false; await this.set(k,v); return true; }
  async delete(k) { this.values.delete(k); }
  async list(prefix) { return [...this.values.keys()].filter(k=>k.startsWith(prefix)).slice(0,500); }
}
const env = { GEO_ACCOUNT:'test-account', GEO_PASSWORD_HASH:await passwordHash('test-password'), GEO_MASTER_KEY:'a'.repeat(64), IMA_ADMIN_SECRET:'admin-test-secret-32-characters-long', APP_ORIGIN:'https://geo.example.test', IMA_OPENAPI_CLIENTID:'ima-client', IMA_OPENAPI_APIKEY:'ima-secret' };
const json = data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
async function fixture(fetcher=async()=>{throw new Error('Unexpected real request');}) {
  assert.equal(typeof router.createHandler,'function','authenticated server router must exist');
  const store=new MemoryStore(), handler=router.createHandler({store,env,fetcher});
  let cookie='',csrf='';
  async function request(path,body,headers={}) {
    const response=await handler(new Request(env.APP_ORIGIN+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{origin:env.APP_ORIGIN,'content-type':'application/json',cookie,'x-csrf-token':csrf,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),{clientIp:'127.0.0.1'});
    if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    const data=await response.json();if(data.csrf)csrf=data.csrf;
    return {status:response.status,data,response};
  }
  return {request,store,handler,login:()=>request('auth/login',{account:env.GEO_ACCOUNT,password:'test-password'})};
}
test('unauthenticated API rejects reads, configuration and generation',async()=>{
  const f=await fixture();
  for(const [path,body] of [['settings'],['settings/model',{}],['batches',{}],['ima/update',{}]]) assert.equal((await f.request(path,body)).status,401);
});
test('login cookies, CSRF, origin and logout protect mutations',async()=>{
  const f=await fixture();const login=await f.login();assert.equal(login.status,200);
  assert.match(login.response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Secure/);
  assert.equal((await f.request('settings/model',{}, {'x-csrf-token':''})).status,403);
  assert.equal((await f.request('settings/model',{}, {origin:'https://attacker.test'})).status,403);
  assert.equal((await f.request('auth/logout',{})).status,200);
  assert.equal((await f.request('settings')).status,401);
});
test('keys are encrypted, redacted, session isolated and blank save preserves a key',async()=>{
  const f=await fixture();await f.login();
  assert.equal((await f.request('settings/model',{provider:'kimi',slot:'secondary',apiKey:'private-test-key'})).status,200);
  assert.equal((await f.request('settings/model',{provider:'kimi',slot:'secondary',apiKey:''})).status,200);
  const settings=await f.request('settings');assert.equal(settings.data.providers.kimi.configured,true);
  assert.doesNotMatch(JSON.stringify(settings.data),/private-test-key|ima-secret/);
  assert.doesNotMatch(JSON.stringify([...f.store.values]),/private-test-key|ima-secret/);
  await f.login();assert.equal((await f.request('settings')).data.providers.kimi.configured,false);
});
test('encryption binds secrets to their owner',()=>{
  const encrypted=seal({key:'private'},env,'owner-a');assert.deepEqual(unseal(encrypted,env,'owner-a'),{key:'private'});
  assert.throws(()=>unseal(encrypted,env,'owner-b'));
});
test('IMA update requires administrator; failure preserves old credentials',async()=>{
  let succeed=false;
  const f=await fixture(async(url,init)=>{
    assert.equal(new URL(url).hostname,'ima.qq.com');
    assert.equal(init.headers['ima-openapi-apikey'],'new-ima-key');
    return json(succeed?{code:0,data:{info_list:[{name:'copilot',id:'copilot-id'}],is_end:true}}:{code:20004});
  });await f.login();
  const body={clientId:'new-client',apiKey:'new-ima-key',expiresAt:'2026-12-01',adminSecret:env.IMA_ADMIN_SECRET};
  assert.equal((await f.request('ima/update',{...body,adminSecret:'wrong'})).status,403);
  assert.equal((await f.request('ima/update',body)).status,502);
  assert.equal(await f.store.get('shared/ima'),null);
  succeed=true;assert.equal((await f.request('ima/update',body)).status,200);
  assert.doesNotMatch(JSON.stringify(await f.store.get('shared/ima')),/new-ima-key/);
  assert.equal((await f.request('settings')).data.ima.expiresAt,'2026-12-01');
});
test('model uses fixed endpoint, rejects incomplete output and never retries',async()=>{
  let calls=0;const model=modelSelection('kimi','secondary');
  await assert.rejects(complete(model,'secret',[],{fetcher:async(url,init)=>{calls++;assert.equal(new URL(url).hostname,'api.moonshot.cn');assert.equal(JSON.parse(init.body).model,'kimi-k3');return json({model:'kimi-k3',choices:[{finish_reason:'length',message:{content:'partial'}}]});}}),/未完整/);
  assert.equal(calls,1);
});
test('task validation rejects missing documents and oversized batches',async()=>{
  const f=await fixture();await f.login();await f.request('settings/model',{provider:'deepseek',slot:'primary',apiKey:'test-key'});
  const response=await f.request('batches',{requestId:crypto.randomUUID(),rows:[['品牌名','GEO知识库','问句','篇数'],['品牌','品牌库','问题','1']],companies:[]});
  assert.equal(response.status,400);assert.match(response.data.error,/公司/);
});

test('full batch uses complete originals, locks model and deduplicates every submitted step',async()=>{
  let paid=0,imaReads=0;
  const f=await fixture(async(url,init)=>{
    const body=JSON.parse(init.body);const pathname=new URL(url).pathname;
    if(new URL(url).hostname!=='ima.qq.com'){
      paid++;assert.equal(body.model,'deepseek-v4-flash','batch model must not follow later settings changes');
      assert.ok(JSON.stringify(body.messages).includes('COMPANY_TAIL'));assert.ok(JSON.stringify(body.messages).includes('FULL_EVIDENCE'));
      const audit=body.messages[0].content.includes('只返回 JSON');
      return json({model:body.model,choices:[{finish_reason:'stop',message:{content:audit?'{"passed":true,"issues":[]}':'# 完整文章\n\n基于品牌资料的正文。'}}]});
    }
    imaReads++;
    let data;
    if(pathname.endsWith('search_knowledge_base'))data={info_list:[{name:'copilot',id:'rules'},{name:'品牌库',id:'brand-kb'}],is_end:true};
    else if(pathname.endsWith('get_knowledge_list'))data={knowledge_list:body.folder_id?[{title:'完整规则.md',media_id:'rule-'+body.folder_id,media_type:11}]:[{title:'geo-content-generator',media_id:'folder-gen',media_type:99},{title:'geo-audit',media_id:'folder-audit',media_type:99},{title:'零雪AI_记忆库完整档案_20260908.md',media_id:'memory',media_type:11}],is_end:true};
    else if(pathname.endsWith('search_knowledge'))data={info_list:[{title:'品牌依据.md',media_id:'evidence',media_type:11}],is_end:true};
    else if(pathname.endsWith('get_media_info'))data={media_type:11,notebook_ext_info:{notebook_id:body.media_id}};
    else if(pathname.endsWith('get_doc_content'))data={content:body.note_id==='evidence'?'FULL_EVIDENCE：真实品牌依据':'完整规则和记忆。'};
    else throw new Error('Unexpected IMA endpoint');
    return json({code:0,data});
  });
  await f.login();await f.request('settings/model',{provider:'deepseek',slot:'primary',apiKey:'private-test-key'});
  const payload={requestId:crypto.randomUUID(),rows:[['品牌名','GEO知识库','问句'],['品牌','品牌库','品牌问题']],companies:[{name:'品牌.md',brand:'品牌',text:'事实'.repeat(7000)+'COMPANY_TAIL'}]};
  let b=(await f.request('batches',payload)).data;
  const second=(await f.request('batches',payload)).data;assert.equal(b.id,second.id);
  await f.request('settings/model',{provider:'kimi',slot:'secondary',apiKey:'other-model-key'});
  for(let i=0;i<30&&b.status==='ready';i++){
    const seq=b.seq;
    b=(await f.request(`batches/${b.id}/step`,{seq})).data;
    const count=paid+imaReads;
    const duplicate=await f.request(`batches/${b.id}/step`,{seq});assert.equal(duplicate.status,200);assert.equal(paid+imaReads,count,'no duplicate IMA or model calls');
  }
  assert.equal(b.status,'completed',b.error);assert.equal(paid,2,'one generation and one audit');
  const details=(await f.request('batches/'+b.id)).data;assert.equal(details.articles.length,1);assert.match(details.articles[0].markdown,/完整文章/);
  assert.doesNotMatch(JSON.stringify([...f.store.values]),/COMPANY_TAIL|FULL_EVIDENCE|private-test-key/);
  await f.login();assert.equal((await f.request('batches/'+b.id)).status,404);
});

test('parallel stage calls have a single claim and failures do not retry themselves',async()=>{
  let calls=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const f=await fixture(async()=>{calls++;await gate;return json({code:20004});});
  await f.login();await f.request('settings/model',{provider:'deepseek',slot:'primary',apiKey:'test-key'});
  const b=(await f.request('batches',{requestId:crypto.randomUUID(),rows:[['品牌名','GEO知识库','问句'],['品牌','品牌库','问题']],companies:[{name:'公司.md',brand:'品牌',text:'公司事实'}]})).data;
  const first=f.request(`batches/${b.id}/step`,{seq:0});
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await f.request(`batches/${b.id}/step`,{seq:0})).status,409);
  release();const result=await first;assert.equal(result.data.status,'failed');assert.equal(calls,1);
  const again=await f.request(`batches/${b.id}/step`,{seq:result.data.seq});assert.equal(again.data.status,'failed');assert.equal(calls,1);
});

export {MemoryStore,env,fixture,json};
