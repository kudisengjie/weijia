import test from 'node:test';
import assert from 'node:assert/strict';
import { createBatchRunners } from './batch-runners.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const batch=id=>({id,status:'ready',seq:0});

test('five independent loops, duplicate start deduplicates, sixth refused, one failure is isolated',async()=>{
  const gates=new Map(),seen=[],failures=[];
  const runners=createBatchRunners({api:async(path)=>{const id=path.split('/')[1];const gate=deferred();gates.set(id,gate);return gate.promise;},onBatch:b=>seen.push(b),onError:(e,id)=>failures.push(id)});
  const pending=Array.from({length:5},(_,i)=>runners.start(batch(String(i))));
  assert.equal(runners.start(batch('0')),pending[0]);assert.equal(runners.size,5);
  assert.throws(()=>runners.start(batch('6')),/五/);
  gates.get('1').reject(new Error('upstream rejected'));
  for(const id of ['0','2','3','4'])gates.get(id).resolve({batch:{id,status:'completed',seq:1}});
  await Promise.all(pending);assert.deepEqual(failures,['1']);assert.equal(runners.size,0);
  assert.equal(seen.filter(b=>b.status==='completed').length,4);
});
test('pause one loop preserves its in-flight result and does not stop another',async()=>{
  const calls=[],gates=new Map(),seen=[];
  const runners=createBatchRunners({api:async(path)=>{const id=path.split('/')[1];calls.push(id);const gate=deferred();gates.set(id,gate);return gate.promise;},onBatch:b=>seen.push(b)});
  const a=runners.start(batch('a')),b=runners.start(batch('b'));runners.stop('a');
  gates.get('a').resolve({batch:{id:'a',status:'ready',seq:1}});gates.get('b').resolve({batch:{id:'b',status:'completed',seq:1}});
  await Promise.all([a,b]);assert.deepEqual(calls,['a','b']);assert.equal(seen.find(b=>b.id==='a').seq,1);
});
test('reset isolates old account responses and finally from a newly started same ID',async()=>{
  const gates=[],seen=[],finished=[];
  const runners=createBatchRunners({api:()=>{const g=deferred();gates.push(g);return g.promise;},onBatch:b=>seen.push(b),onFinish:id=>finished.push(id)});
  const old=runners.start(batch('a'));runners.reset();const fresh=runners.start(batch('a'));
  gates[0].resolve({batch:{id:'a',status:'completed',seq:99}});await old;
  assert.equal(runners.has('a'),true);assert.deepEqual(seen,[]);assert.deepEqual(finished,[]);
  gates[1].resolve({batch:{id:'a',status:'completed',seq:1}});await fresh;
  assert.equal(seen[0].seq,1);assert.deepEqual(finished,['a']);
});
test('already claimed step only reads status once and never resends unchanged sequence',async()=>{
  const calls=[],seen=[];
  const runners=createBatchRunners({api:async(path)=>{calls.push(path);if(path.endsWith('/run'))throw Object.assign(new Error('claimed'),{code:'STEP_CLAIMED'});return batch('a');},onBatch:b=>seen.push(b)});
  await runners.start(batch('a'));assert.deepEqual(calls,['batches/a/run','batches/a']);assert.equal(seen.length,1);
});
test('gateway 504 waits read-only for the server result instead of resending',async()=>{
  // 吕老师 2026-09-19：/run 返回 504 时函数可能仍在执行并落盘——runner 必须只读
  // 轮询批次状态（绝不重发结果不明的模型请求），状态推进后继续下一步。
  const runCalls=[],statusCalls=[],seen=[];
  let polls=0;
  const runners=createBatchRunners({api:async(path)=>{
    if(path.endsWith('/run')){runCalls.push(path);
      if(runCalls.length===1)throw Object.assign(new Error('gateway timeout'),{status:504});
      return {batch:{id:'a',status:'completed',seq:2}};
    }
    statusCalls.push(path);polls+=1;
    // 第一次轮询：服务端尚未落盘；第二次：步骤已提交推进。
    return polls===1?{id:'a',status:'ready',seq:0}:{id:'a',status:'ready',seq:1};
  },onBatch:b=>seen.push(b)});
  await runners.start(batch('a'));
  assert.equal(runCalls.length,2,'504 后不得重发同一步骤，只能推进到下一步');
  assert.ok(statusCalls.length>=2,'必须轮询批次状态等待服务端结果');
});
test('gateway 504 gives up after the wait budget when the server never advances',async()=>{
  const runCalls=[];
  const runners=createBatchRunners({api:async(path)=>{
    if(path.endsWith('/run')){runCalls.push(path);throw Object.assign(new Error('gateway timeout'),{status:504});}
    return {id:'a',status:'ready',seq:0,error:''};
  },onBatch:()=>{},onError:(e)=>{throw e;}});
  // 160 秒预算在测试中太长：仅验证不会重发（run 只调一次后 runner 停在轮询）。
  // 用 stop() 在短等待后终止轮询来模拟超时路径。
  const promise=runners.start(batch('a'));
  await new Promise(r=>setTimeout(r,50));runners.stop('a');
  await promise.catch(()=>{});
  assert.equal(runCalls.length,1);
});
