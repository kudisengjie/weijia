// One driver per batch. Server claims, immutable snapshots and billing remain authoritative.
export function createBatchRunners({api,onBatch=()=>{},onError=()=>{},onFinish=()=>{}}){
  const runs=new Map();
  function start(batch){
    if(runs.has(batch.id))return runs.get(batch.id).promise;
    if(runs.size>=5)throw new Error('最多同时运行五个工作区。');
    const run={stopped:false,promise:null};runs.set(batch.id,run);
    const current=()=>runs.get(batch.id)===run;
    run.promise=(async()=>{
      let b=batch;
      try{
        while(current()&&!run.stopped&&b.status==='ready'&&!b.pauseRequested){
          let wait=0;
          try{const response=await api(`batches/${b.id}/run`,{seq:b.seq,maxSteps:1});b=response.batch;wait=b.error?response.nextPollMs||1200:0;}
          catch(error){
            if(error.code==='STEP_CLAIMED'){
              const latest=await api(`batches/${b.id}`);
              if(!current())return;
              onBatch(latest);
              if(latest.seq===b.seq)break; // Do not resend an uncertain in-flight step.
              b=latest;continue;
            }
            // 吕老师 2026-09-19 深度排查：网关 504 时函数可能仍在执行并落盘。
            // 仅对明确的服务端 5xx 进入只读轮询等待结果（绝不重发结果不明的模型
            // 请求），最长 160 秒；连接完全断开（无状态码）仍快速失败，由用户重试。
            if(error.status>=500){
              let resolved=null;
              for(let waited=0;waited<160000&&(current()&&!run.stopped);waited+=8000){
                await new Promise(resolve=>setTimeout(resolve,8000));
                const latest=await api('batches/'+b.id).catch(()=>null);
                if(!latest)continue;
                onBatch(latest);
                if(latest.seq!==b.seq||latest.status!=='ready'||latest.error){resolved=latest;break;}
              }
              if(!current())return;
              if(resolved){b=resolved;if(b.status==='ready'&&!b.error)continue;break;}
            }
            throw error;
          }
          if(!current())return;
          onBatch(b);
          if(wait&&!run.stopped&&b.status==='ready')await new Promise(resolve=>setTimeout(resolve,wait));
        }
      }catch(error){if(current()&&error.code!=='STALE_RESPONSE')onError(error,batch.id);}
      finally{if(current()){runs.delete(batch.id);await onFinish(batch.id);}}
    })();
    return run.promise;
  }
  return {start,has:id=>runs.has(id),get size(){return runs.size;},stop(id){const run=runs.get(id);if(run)run.stopped=true;},reset(){for(const run of runs.values())run.stopped=true;runs.clear();}};
}
