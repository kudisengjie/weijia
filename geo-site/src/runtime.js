import { getModelPresentation, MODEL_PROVIDER_IDS } from './model-switch.js';

const $ = id => document.getElementById(id);
function node(tag, text, className) { const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n; }
function message(id,text,error=false) { $(id).textContent=text;$(id).classList.toggle('is-error',error); }
async function download(article) {
  if(article.artifactId){
    const response=await fetch('/api/artifacts/'+encodeURIComponent(article.artifactId),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(125000)});
    if(!response.ok){let data={};try{data=await response.json();}catch{}throw new Error(data.error||'文章文件读取失败。');}
    const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=article.filename||`article-${article.index}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
  }
  const url=URL.createObjectURL(new Blob([article.markdown],{type:'text/markdown;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`${article.index}-${article.brand}-${article.title}`.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,120)+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function bootstrapAuthenticatedWorkspace({showWorkspace,refreshSettings,loadHistory,showServiceFailure}) {
  showWorkspace();
  try {await refreshSettings();await loadHistory();return true;}
  catch(error) {showServiceFailure(error);return false;}
}
export function initializeRuntime({renderSelectedModel,changeView,getUploads}) {
  let csrf='',settings=null,activeBatch=null,driving=false,pauseRequested=false,pendingCreate=null;
  const shell=document.querySelector('.geo-shell');
  function showLogin() {pauseRequested=true;csrf='';settings=null;shell.hidden=true;$('login-page').hidden=false;$('model-key').value='';$('ima-form').reset();}
  function toast(text) {message('runtime-toast',text,true);$('runtime-toast').hidden=false;}
  async function api(path,body) {
    let response;
    try {response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(125000)});}
    catch {throw new Error('连接中断或请求超时，未自动重试。批次可在历史记录中读取进度。');}
    let data;try{data=await response.json();}catch{throw new Error('运行接口未部署，请管理员检查 EdgeOne 的 Python Cloud Functions 与 PostgreSQL 配置。');}
    if(!response.ok){if(response.status===401&&path!=='auth/login')showLogin();const e=new Error(data.error||'请求失败。');e.code=data.code;e.status=response.status;throw e;}
    return data;
  }
  function selected() {const input=document.querySelector('input[name="model-option"]:checked');return getModelPresentation(input.dataset.provider,input.dataset.slot);}
  function renderCredentials() {
    const choice=selected(),configured=Boolean(settings?.providers[choice.id]?.configured);
    $('credential-provider').textContent=`当前编辑：${choice.provider} · ${choice.model}${configured?' · 已保存密钥':' · 尚未配置'}`;
    $('custom-model-id').placeholder=`留空使用 ${choice.modelId}`;
    document.querySelectorAll('.geo-provider-card').forEach(card=>{const provider=card.querySelector('input').dataset.provider;card.querySelector('.geo-provider-card__status').textContent=settings?.providers[provider]?.configured?'已配置':'未配置';});
  }
  function renderConnections() {
    if(!settings)return;
    const model=settings.model,configured=settings.providers[model.id].configured;
    document.querySelectorAll('[data-selected-model-provider]').forEach(n=>n.textContent=model.provider);
    document.querySelectorAll('[data-selected-model-name]').forEach(n=>n.textContent=model.model);
    document.querySelectorAll('[data-selected-model-preflight]').forEach(n=>n.textContent=`${model.label} · ${configured?'已配置，尚未验证':'未配置 API'}`);
    document.querySelectorAll('[data-selected-model-service]').forEach(n=>n.textContent=`${model.provider} · ${configured?'已配置':'未配置'}`);
    document.querySelectorAll('[data-selected-model-status]').forEach(n=>n.textContent=configured?'已配置':'未配置');
    document.querySelectorAll('[data-selected-model-label]').forEach(n=>n.textContent=activeBatch?.model.label||model.label);
    document.querySelectorAll('[data-selected-model-connection]').forEach(n=>n.textContent=`已保存：${model.label} · ${configured?'已配置':'未配置'}`);
    document.querySelectorAll('[data-ima-status]').forEach(n=>n.textContent=settings.ima.configured?'IMA · 已配置（运行时校验权限）':'IMA · 等待管理员配置');
    document.querySelectorAll('[data-ima-badge-status]').forEach(n=>n.textContent=settings.ima.configured?'已配置':'未配置');
    const chip=document.querySelector('.geo-service-chips > span');chip.textContent=settings.ima.configured?'IMA · 已配置':'IMA · 未配置';
    const expiry=settings.ima.expiresAt;
    $('ima-expiry').textContent=expiry?`到期日期：${expiry}${Date.parse(expiry)-Date.now()<7*86400000?' · 即将到期或已过期，请管理员更新':''}`:'到期日期尚未登记。共享凭据由管理员维护。';
    document.querySelectorAll('[data-credit-balance]').forEach(n=>n.textContent=`积分：${settings.credits?.balance??'—'}`);
    document.querySelectorAll('[data-subscription-expiry]').forEach(n=>n.textContent=settings.subscription?.expiresAt?`有效期至：${new Date(settings.subscription.expiresAt).toLocaleDateString('zh-CN')}`:'有效期：未配置');
    const admin=$('tenant-admin');if(admin)admin.hidden=!['owner','admin'].includes(settings.subscription?.role);
  }
  async function refreshSettings() {settings=await api('settings');renderSelectedModel(settings.model.id,settings.model.slot);$('custom-model-id').value=settings.model.modelId===getModelPresentation(settings.model.id,settings.model.slot).modelId?'':settings.model.modelId;renderCredentials();renderConnections();}
  async function enter() {return bootstrapAuthenticatedWorkspace({
    showWorkspace(){ $('login-page').hidden=true;shell.hidden=false;$('login-password').value=''; },
    refreshSettings,
    loadHistory:history,
    showServiceFailure(error){toast(error.message);},
  });}
  async function action(button,id,fn) {
    if(button.disabled)return;button.disabled=true;message(id,'处理中…');
    try{await fn();}catch(error){message(id,error.message,true);}finally{button.disabled=false;}
  }
  $('login-form').addEventListener('submit',event=>{event.preventDefault();action(event.submitter,'login-message',async()=>{
    const form=new FormData(event.currentTarget);const data=await api('auth/login',{account:form.get('account'),password:form.get('password')});csrf=data.csrf;await enter();message('login-message','');
  });});
  $('toggle-password').addEventListener('click',()=>{const input=$('login-password'),shown=input.type==='password';input.type=shown?'text':'password';$('toggle-password').textContent=shown?'隐藏':'显示';$('toggle-password').setAttribute('aria-pressed',String(shown));$('toggle-password').setAttribute('aria-label',shown?'隐藏密码':'显示密码');});
  $('logout-button').addEventListener('click',async()=>{
    if(driving){toast('请先暂停批次，等待当前步骤结束后退出。');return;}
    if(!confirm('确认退出工作台？模型设置、批次历史和已完成文章仍保存在当前账号中。'))return;
    try{await api('auth/logout',{});location.reload();}catch(error){toast(error.message);}
  });
  document.querySelectorAll('input[name="model-option"]').forEach(input=>input.addEventListener('change',()=>{if(input.checked){$('model-key').value='';$('custom-model-id').value='';renderCredentials();renderConnections();message('model-message','选择已更改，请保存后用于新批次。');}}));
  $('model-form').addEventListener('submit',event=>{event.preventDefault();action(event.submitter,'model-message',async()=>{
    const choice=selected();await api('settings/model',{provider:choice.id,slot:choice.slot,modelId:$('custom-model-id').value,apiKey:$('model-key').value});$('model-key').value='';await refreshSettings();message('model-message','已保存。密钥已加密；“已配置”不代表已经通过真实接口测试。');
  });});
  $('test-model').addEventListener('click',event=>action(event.currentTarget,'model-message',async()=>{
    const data=await api('models/test',{});message('model-message',`${data.model}：真实请求成功。此测试会消耗少量模型额度。`);
  }));
  $('remove-model-key').addEventListener('click',event=>action(event.currentTarget,'model-message',async()=>{
    const choice=selected();if(!confirm(`移除 ${choice.provider} 的密钥？使用该厂商的未完成批次将无法继续。`)){message('model-message','已取消。');return;}
    await api('settings/model',{provider:choice.id,slot:choice.slot,removeKey:true});await refreshSettings();message('model-message','该厂商密钥已移除，可重新填写。');
  }));
  $('ima-form').addEventListener('submit',event=>{event.preventDefault();action(event.submitter,'ima-message',async()=>{
    const body=Object.fromEntries(new FormData(event.currentTarget));await api('ima/update',body);$('ima-form').reset();await refreshSettings();message('ima-message','IMA 新凭据已验证并保存，后续请求立即使用。');
  });});
  $('clear-ima-cache').addEventListener('click',event=>action(event.currentTarget,'ima-cache-message',async()=>{
    const result=await api('ima/cache/clear',{});message('ima-cache-message',`共享 IMA 缓存已清除，当前代数 ${result.generation}。`);
  }));
  $('member-form').addEventListener('submit',event=>{event.preventDefault();action(event.submitter,'member-message',async()=>{
    const values=Object.fromEntries(new FormData(event.currentTarget));const iso=value=>new Date(value).toISOString();
    await api('tenant/members',{username:values.username,password:values.password,role:values.role,startsAt:iso(values.startsAt),expiresAt:iso(values.expiresAt)});event.currentTarget.reset();message('member-message','子账号已创建，可使用自己的模型 API 登录。');
  });});
  $('credit-form').addEventListener('submit',event=>{event.preventDefault();action(event.submitter,'credit-message',async()=>{
    const values=Object.fromEntries(new FormData(event.currentTarget));const result=await api('credits/adjust',{amount:Number(values.amount),kind:values.kind,idempotencyKey:crypto.randomUUID(),note:values.note});message('credit-message',`积分调整成功，当前余额 ${result.balance}。`);await refreshSettings();
  });});
  function renderBatch(b) {
    activeBatch=b;const panel=$('batch-progress');panel.hidden=false;panel.replaceChildren();
    panel.append(node('span',b.model.label,'login-eyebrow'),node('h2',`${b.phaseLabel} · ${b.completed}/${b.total} 篇`));
    const progress=document.createElement('progress');progress.max=b.total;progress.value=b.completed;progress.setAttribute('aria-label','已完成文章进度');panel.append(progress);
    panel.append(node('p',b.error|| (driving?'正在执行。可以暂停，当前步骤结束后停止。':'进度已保存，点击继续运行。'),b.error?'runtime-error':'runtime-hint'));
    const controls=node('div',undefined,'runtime-buttons');
    if(b.status!=='completed'){
      const proceed=node('button',driving?'当前步骤执行中':b.status==='failed'?'手动重试失败步骤':'继续运行','runtime-primary');proceed.disabled=driving;
      proceed.addEventListener('click',async()=>{
        try{if(b.status==='failed'){if(!confirm('确认只重试失败步骤？若上次请求超时，提供商可能已扣费。'))return;b=await api(`batches/${b.id}/step`,{seq:b.seq,retry:true});}await drive(b);}catch(error){toast(error.message);}
      });controls.append(proceed);
      if(driving){const pause=node('button','暂停后续步骤');pause.addEventListener('click',()=>{pauseRequested=true;pause.disabled=true;pause.textContent='等待当前步骤结束…';});controls.append(pause);}
      const refresh=node('button','读取一次最新状态');refresh.disabled=driving;refresh.addEventListener('click',async()=>{try{renderBatch(await api('batches/'+b.id));}catch(error){toast(error.message);}});controls.append(refresh);
      if(!driving&&b.status!=='failed'){const recover=node('button','恢复超时步骤');recover.addEventListener('click',async()=>{if(!confirm('仅用于步骤已提交但超过 150 秒无进展的情况。上次调用可能已计费，确认手动恢复？'))return;try{renderBatch(await api(`batches/${b.id}/step`,{seq:b.seq,retry:true}));}catch(error){toast(error.message);}});controls.append(recover);}
    }
    panel.append(controls,node('p','任务状态与文章文件已保存到服务端；关闭页面后可从历史批次继续查看或下载。','runtime-hint'));
    const modelLocked=b.status!=='completed';document.querySelectorAll('input[name="model-option"], #model-key, #custom-model-id, #model-form button').forEach(input=>{input.disabled=modelLocked;});
    for(const article of b.articles||[]){const row=node('div',undefined,'runtime-article');row.append(node('strong',article.title));const button=node('button','下载 MD');button.addEventListener('click',()=>download(article).catch(error=>toast(error.message)));row.append(button);panel.append(row);}
    $('cabin-state').textContent=b.status==='failed'?'需要处理':b.phaseLabel;$('status-task').textContent=`${b.completed}/${b.total}`;
    const apiCounter=document.querySelector('.geo-status-list > div:last-child dd');apiCounter.textContent=`${b.requests} 次请求步骤`;
    renderConnections();
  }
  async function drive(b) {
    if(driving)return;driving=true;pauseRequested=false;$('run-task').disabled=true;
    try{
      while(!pauseRequested&&b.status==='ready'){
        renderBatch(b);const response=await api(`batches/${b.id}/run`,{seq:b.seq,maxSteps:2});b=response.batch;
      }
      b=await api('batches/'+b.id);renderBatch(b);
    }catch(error){toast(error.message);}
    finally{driving=false;$('run-task').disabled=false;renderBatch(activeBatch||b);await history().catch(e=>toast(e.message));}
  }
  $('run-task').addEventListener('click',async event=>{
    if(driving||event.currentTarget.disabled)return;const button=event.currentTarget;button.disabled=true;$('runtime-toast').hidden=true;
    try{
      if(!pendingCreate)pendingCreate={requestId:crypto.randomUUID(),...getUploads()};
      const b=await api('batches',pendingCreate);pendingCreate=null;await drive(b);
    }catch(error){toast(error.message);if(error.status>=400&&error.status<500)pendingCreate=null;}
    finally{button.disabled=false;}
  });
  async function history() {
    const {batches}=await api('batches');const list=$('history-list'),completed=$('completed-list');list.replaceChildren();completed.replaceChildren();
    if(!batches.length){list.append(node('p','还没有批次。上传资料并保存模型 API 后即可开始。','runtime-panel'));completed.append(node('p','还没有通过审核的文章。','runtime-panel'));return;}
    for(const b of batches){
      const row=node('article',undefined,'runtime-panel runtime-history');row.append(node('h2',b.title),node('p',`${b.model.label} · ${b.completed}/${b.total} 篇 · ${b.phaseLabel}`));
      const button=node('button','打开批次');button.addEventListener('click',async()=>{if(driving){toast('请先暂停当前批次。');return;}try{renderBatch(await api('batches/'+b.id));changeView('workspace');$('batch-progress').scrollIntoView({behavior:'smooth',block:'center'});}catch(error){toast(error.message);}});row.append(button);list.append(row);
      if(b.completed){const group=node('article',undefined,'runtime-panel');group.append(node('h2',`${b.title} · ${b.completed} 篇已通过审核`));const load=node('button','展开文章下载');load.addEventListener('click',async()=>{load.disabled=true;try{const detail=await api('batches/'+b.id);for(const article of detail.articles){const entry=node('div',undefined,'runtime-article');entry.append(node('span',article.title));const d=node('button','下载 MD');d.addEventListener('click',()=>download(article).catch(error=>toast(error.message)));entry.append(d);group.append(entry);}load.remove();}catch(error){load.disabled=false;toast(error.message);}});group.append(load);completed.append(group);}
    }
    if(!completed.childElementCount)completed.append(node('p','还没有通过审核的文章。','runtime-panel'));
  }
  document.querySelectorAll('[data-view="history"],[data-view="completed"]').forEach(button=>button.addEventListener('click',()=>history().catch(e=>toast(e.message))));
  api('auth/session').then(async data=>{csrf=data.csrf;await enter();}).catch(error=>{showLogin();message('login-message',error.code==='LOGIN_REQUIRED'?'请输入账号和密码。':error.message,error.code!=='LOGIN_REQUIRED');});
}
