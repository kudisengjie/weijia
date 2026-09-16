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
