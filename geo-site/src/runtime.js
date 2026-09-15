import { getModelPresentation } from './model-switch.js';
import { AUTH_TAB_MARKER, createAuthFlow, shouldRestoreSession } from './auth-flow.js';

export function modelIsLocked(settings,batch) {
  return Boolean(settings?.modelLocked || batch && !['completed','cancelled'].includes(batch.status));
}
export function batchStatusLabel(batch) {
  if(batch.status==='completed')return batch.failedTasks?.length?'已结束 · 部分任务未完成':'全部完成';
  return {cancelled:'已取消',paused:'已暂停',failed:'需要处理'}[batch.status] || (batch.pauseRequested?'正在暂停':batch.phaseLabel);
}
export function pendingOperation(previous,values,makeId=()=>crypto.randomUUID()) {
  const signature=JSON.stringify(values);
  return previous?.signature===signature?previous:{signature,body:{...values,idempotencyKey:makeId()}};
}
function localDateTime(value) {const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}

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
export function initializeRuntime({renderSelectedModel,changeView,getUploads,clearUploads=()=>{}}) {
  let csrf='',settings=null,activeBatch=null,driving=false,pauseRequested=false,pendingCreate=null,pendingCredit=null,members=[];
  const auth=createAuthFlow();
  const actions=new WeakMap();
  const rememberTab=value=>{try{if(value)sessionStorage.setItem(AUTH_TAB_MARKER,'1');else sessionStorage.removeItem(AUTH_TAB_MARKER);}catch{}};
  let expiryTimer;
  const shell=document.querySelector('.geo-shell');
  function showLogin() {
    auth.invalidate();rememberTab(false);clearTimeout(expiryTimer);pauseRequested=true;csrf='';settings=null;activeBatch=null;pendingCreate=null;pendingCredit=null;members=[];
    shell.hidden=true;$('login-page').hidden=false;$('login-password').value='';$('login-password').type='password';$('toggle-password').textContent='显示';$('toggle-password').setAttribute('aria-pressed','false');$('toggle-password').setAttribute('aria-label','显示密码');
    $('model-form').reset();$('ima-form').reset();$('member-form').reset();$('credit-form').reset();$('subscription-form').reset();defaultMemberDates();clearUploads();
    for(const id of ['batch-progress','history-list','completed-list','managed-user','managed-user-summary','member-ledger','own-ledger'])$(id).replaceChildren();
    $('tenant-admin').hidden=true;document.querySelector('.ima-admin').hidden=true;$('batch-progress').hidden=true;$('runtime-toast').hidden=true;renderModelLock();
    const submit=document.querySelector('.login-submit');actions.delete(submit);submit.disabled=false;
  }
  function toast(text) {if(!csrf)return;message('runtime-toast',text,true);$('runtime-toast').hidden=false;}
  async function api(path,body) {
    const operation=auth.epoch;
    let response;
    try {response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(125000)});}
    catch {if(!auth.isCurrent(operation))throw Object.assign(new Error('已忽略旧会话响应。'),{code:'STALE_RESPONSE'});throw new Error('连接中断或请求超时，未自动重试。批次可在历史记录中读取进度。');}
    if(!auth.isCurrent(operation))throw Object.assign(new Error('已忽略旧会话响应。'),{code:'STALE_RESPONSE'});
    let data;try{data=await response.json();}catch{throw new Error('运行接口未部署，请管理员检查 EdgeOne 的 Python Cloud Functions 与 PostgreSQL 配置。');}
    if(!auth.isCurrent(operation))throw Object.assign(new Error('已忽略旧会话响应。'),{code:'STALE_RESPONSE'});
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
    const owner=settings.subscription?.role==='owner';$('tenant-admin').hidden=!owner;document.querySelector('.ima-admin').hidden=!owner;
    const days=Math.ceil((Number(settings.subscription?.expiresAt)-Date.now())/86400000);
    const reminder=!settings.subscription?.active?'服务尚未生效或已到期，请联系管理员调整有效期。已有文章仍可下载。':days<=7?`服务将在 ${Math.max(0,days)} 天内到期，请及时联系管理员续期。`:'服务有效，每条有效任务预扣 1 积分，未完整输出的任务自动返还。';
    message('subscription-reminder',reminder,!settings.subscription?.active || days<=3);
    renderModelLock();
  }
  function renderModelLock() {const locked=modelIsLocked(settings,activeBatch);document.querySelectorAll('input[name="model-option"], #model-key, #custom-model-id, #model-form button').forEach(input=>{input.disabled=locked;});}
  async function refreshSettings() {settings=await api('settings');renderSelectedModel(settings.model.id,settings.model.slot);$('custom-model-id').value=settings.model.modelId===getModelPresentation(settings.model.id,settings.model.slot).modelId?'':settings.model.modelId;renderCredentials();renderConnections();}
  async function enter() {return bootstrapAuthenticatedWorkspace({
    showWorkspace(){ $('login-page').hidden=true;shell.hidden=false;$('login-password').value=''; },
    refreshSettings,
    async loadHistory(){await history();await loadMembers();},
    showServiceFailure(error){if(error.code!=='STALE_RESPONSE')toast(error.message);},
  });}
  async function acceptSession(operation,data) {
    if(!auth.isCurrent(operation))return;
    if(!auth.accept(operation,data))throw new Error('登录响应无效，请重新输入账号和密码。');
    csrf=data.csrf;rememberTab(true);clearTimeout(expiryTimer);
    expiryTimer=setTimeout(()=>{showLogin();message('login-message','登录已到期，请重新输入密码。');},Math.min(data.expiresAt-Date.now(),2147483647));
    if(location.hash==='#login')window.history.replaceState(null,'',location.pathname+location.search);
    await enter();
  }
  async function action(button,id,fn) {
    if(button.disabled)return;const token=Symbol();actions.set(button,token);button.disabled=true;message(id,'处理中…');
    try{await fn();}catch(error){if(actions.get(button)===token&&error.code!=='STALE_RESPONSE')message(id,error.message,true);}finally{if(actions.get(button)===token){actions.delete(button);button.disabled=false;renderModelLock();}}
  }
  $('login-form').addEventListener('submit',event=>{event.preventDefault();action(event.submitter,'login-message',async()=>{
    const form=new FormData(event.currentTarget),operation=auth.begin();rememberTab(false);
    const data=await api('auth/login',{account:form.get('account'),password:form.get('password')});await acceptSession(operation,data);if(auth.isCurrent(operation))message('login-message','');
  });});
  $('toggle-password').addEventListener('click',()=>{const input=$('login-password'),shown=input.type==='password';input.type=shown?'text':'password';$('toggle-password').textContent=shown?'隐藏':'显示';$('toggle-password').setAttribute('aria-pressed',String(shown));$('toggle-password').setAttribute('aria-label',shown?'隐藏密码':'显示密码');});
  $('logout-button').addEventListener('click',async()=>{
    if(driving){toast('请先暂停批次，等待当前步骤结束后退出。');return;}
    if(!confirm('确认退出工作台？模型设置、批次历史和已完成文章仍保存在当前账号中。'))return;
    auth.begin();$('logout-button').disabled=true;
    try{await api('auth/logout',{});showLogin();message('login-message','已退出，请输入账号和密码。');}
    catch(error){showLogin();message('login-message',error.status===401?'登录已失效，请重新输入密码。':'本机已锁定，但服务器未确认退出。请恢复网络后重新登录以替换旧会话。',error.status!==401);}
    finally{$('logout-button').disabled=false;}
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
    if(!confirm('确认清除全站共享缓存？新批次会重新获取所需资料，正在运行的批次保留其资料版本。')){message('ima-cache-message','已取消。');return;}
    const result=await api('ima/cache/clear',{});message('ima-cache-message',`新批次将使用第 ${result.generation} 版缓存；运行中批次不受影响。`);
  }));
  function defaultMemberDates(){const form=$('member-form');form.elements.startsAt.value=localDateTime(Date.now());form.elements.expiresAt.value=localDateTime(Date.now()+30*86400000);}
  defaultMemberDates();
  $('member-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;action(event.submitter,'member-message',async()=>{
    const values=Object.fromEntries(new FormData(form));const iso=value=>new Date(value).toISOString();
    const created=await api('tenant/members',{username:values.username,password:values.password,role:values.role,startsAt:iso(values.startsAt),expiresAt:iso(values.expiresAt)});form.reset();defaultMemberDates();await loadMembers(created.id);message('member-message','子账号已创建，请为该账号发放积分。用户登录后填写自己的模型 API。');
  });});
  $('credit-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;action(event.submitter,'credit-message',async()=>{
    const values=Object.fromEntries(new FormData(form)),target=managedMember();
    if(!confirm(`确认对账号「${target.username}」${values.kind==='grant'?'发放':'收回'} ${values.amount} 积分？`)){message('credit-message','已取消。');return;}
    pendingCredit=pendingOperation(pendingCredit,{userId:target.id,amount:Number(values.amount),kind:values.kind,note:values.note});
    let result;try{result=await api('credits/adjust',pendingCredit.body);}catch(error){if(error.status>=400&&error.status<500)pendingCredit=null;throw error;}
    pendingCredit=null;message('credit-message',`账号「${target.username}」余额为 ${result.balance} 积分${result.applied?'。':'，本次操作此前已处理，未重复调整。'}`);await refreshSettings();await loadMembers(target.id);
  });});
  function managedMember(){const item=members.find(m=>m.id===$('managed-user').value);if(!item)throw new Error('请先选择要管理的账号。');return item;}
  function renderManagedMember(){const target=members.find(m=>m.id===$('managed-user').value);if(!target)return;
    $('managed-user-summary').textContent=`${target.username} · ${target.balance} 积分 · ${target.active?'服务有效':'未生效或已到期'}`;
    const form=$('subscription-form');form.elements.startsAt.value=localDateTime(target.startsAt||Date.now());form.elements.expiresAt.value=localDateTime(target.expiresAt||Date.now()+30*86400000);
  }
  async function loadMembers(preferred=$('managed-user').value){if(settings?.subscription?.role!=='owner')return;
    members=(await api('tenant/members')).members;const select=$('managed-user');select.replaceChildren();
    for(const member of members){const option=node('option',member.username+(member.role==='owner'?'（总账号）':''));option.value=member.id;select.append(option);}
    if(members.some(m=>m.id===preferred))select.value=preferred;renderManagedMember();await memberLedger();
  }
  function renderLedger(id,data){const region=$(id);region.replaceChildren();
    if(!data.ledger?.length){region.append(node('p','暂无积分流水。','runtime-hint'));return;}
    const table=node('table'),head=node('thead'),header=node('tr'),body=node('tbody');
    for(const title of ['时间','类型','积分变动','任务']){const th=node('th',title);th.scope='col';header.append(th);}head.append(header);
    const names={grant:'管理员发放',revoke:'管理员收回',reserve:'任务预扣',refund:'未完成返还',release:'释放预扣',consume:'任务完成'};
    for(const entry of data.ledger){const row=node('tr');for(const value of [new Date(entry.createdAt).toLocaleString('zh-CN'),names[entry.kind]||entry.kind,`${entry.amount>0?'+':''}${entry.amount}`,entry.taskId?`第 ${entry.taskId} 条`:'—'])row.append(node('td',String(value)));body.append(row);}
    table.append(head,body);region.append(table,node('p','显示最近 100 条流水。','runtime-hint'));
  }
  async function memberLedger(){const userId=$('managed-user').value;if(!userId)return;const data=await api(`tenant/members/${userId}/credits`);if($('managed-user').value===userId)renderLedger('member-ledger',data);}
  $('managed-user').addEventListener('change',()=>{renderManagedMember();memberLedger().catch(e=>toast(e.message));});
  $('refresh-member-ledger').addEventListener('click',event=>action(event.currentTarget,'credit-message',async()=>{await memberLedger();message('credit-message','已读取最新流水。');}));
  $('refresh-own-ledger').addEventListener('click',event=>action(event.currentTarget,'subscription-reminder',async()=>{renderLedger('own-ledger',await api('credits'));await refreshSettings();}));
  $('extend-subscription').addEventListener('click',()=>{const input=$('subscription-form').elements.expiresAt;input.value=localDateTime(Math.max(Date.now(),Date.parse(input.value)||0)+30*86400000);message('subscription-message','已增加 30 天，请点击“保存有效期”生效。');});
  $('subscription-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;action(event.submitter,'subscription-message',async()=>{
    const target=managedMember(),values=Object.fromEntries(new FormData(form));
    await api('tenant/subscription',{userId:target.id,startsAt:new Date(values.startsAt).toISOString(),expiresAt:new Date(values.expiresAt).toISOString()});
    await refreshSettings();await loadMembers(target.id);message('subscription-message',`账号「${target.username}」的有效期已保存。`);
  });});
  function renderBatch(b) {
    if(!csrf||!settings)return;
    activeBatch=b;const panel=$('batch-progress');panel.hidden=false;panel.replaceChildren();
    panel.append(node('span',b.model.label,'login-eyebrow'),node('h2',`${batchStatusLabel(b)} · ${b.completed}/${b.total} 篇`));
    const progress=document.createElement('progress');progress.max=b.total;progress.value=b.completed;progress.setAttribute('aria-label','已完成文章进度');panel.append(progress);
    const terminal=['completed','cancelled'].includes(b.status);
    panel.append(node('p',b.error|| (terminal?'已保存的文章可在下方下载。':b.status==='paused'?'已暂停，积分预扣和模型配置保留。继续运行不会重复预扣。':b.pauseRequested?'暂停请求已提交，等待当前步骤保存结果。':driving?'正在执行。可以暂停，当前步骤结束后停止。':'进度已保存，点击继续运行。'),b.error?'runtime-error':'runtime-hint'));
    if(b.billing)panel.append(node('p',`任务积分：完成 ${b.billing.complete} · 已返还 ${b.billing.refunded+b.billing.released} · 预扣中 ${b.billing.reserved}`,'runtime-hint'));
    for(const failed of b.failedTasks||[])panel.append(node('p',`第 ${failed.taskId} 条任务未完成：${failed.error}`,'runtime-error'));
    const controls=node('div',undefined,'runtime-buttons');
    if(!terminal){
      const proceed=node('button',driving?'当前步骤执行中':b.status==='failed'?'手动重试失败步骤':'继续运行','runtime-primary');proceed.disabled=driving;
      proceed.addEventListener('click',async()=>{
        try{if(b.status==='failed'){if(!confirm('确认重试准备失败的批次？会重新预扣尚未完成任务的积分。'))return;b=await api(`batches/${b.id}/step`,{seq:b.seq,retry:true});}else if(b.status==='paused'){b=await api(`batches/${b.id}/resume`,{});}await drive(b);}catch(error){toast(error.message);}
      });controls.append(proceed);
      proceed.disabled=driving||Boolean(b.pauseRequested&&b.status!=='paused');
      if(b.status==='ready'&&!b.pauseRequested){const pause=node('button','暂停后续步骤');pause.addEventListener('click',async()=>{pause.disabled=true;pauseRequested=true;try{renderBatch(await api(`batches/${b.id}/pause`,{}));}catch(error){toast(error.message);pause.disabled=false;}});controls.append(pause);}
      const refresh=node('button','读取一次最新状态');refresh.disabled=driving;refresh.addEventListener('click',async()=>{try{renderBatch(await api('batches/'+b.id));}catch(error){toast(error.message);}});controls.append(refresh);
      if(!driving&&b.status==='ready'){const recover=node('button','处理超时步骤');recover.addEventListener('click',async()=>{if(!confirm('仅处理超过 150 秒无进展的步骤。结果不明的任务会跳过并退款，不重复发送模型请求。'))return;try{renderBatch(await api(`batches/${b.id}/step`,{seq:b.seq,retry:true}));}catch(error){toast(error.message);}});controls.append(recover);}
      const cancel=node('button','取消批次并返还未完成积分');cancel.addEventListener('click',async()=>{if(!confirm('确认取消？未完整输出的任务积分会返还。已发给模型的请求无法撤回，提供商可能仍计费。'))return;cancel.disabled=true;pauseRequested=true;try{const result=await api(`batches/${b.id}/cancel`,{});activeBatch=result;await refreshSettings();renderBatch(await api('batches/'+b.id));await history();}catch(error){toast(error.message);cancel.disabled=false;}});controls.append(cancel);
    }
    panel.append(controls,node('p','任务状态与文章文件已保存到服务端；关闭页面后可从历史批次继续查看或下载。','runtime-hint'));
    renderModelLock();
    for(const article of b.articles||[]){const row=node('div',undefined,'runtime-article');row.append(node('strong',article.title));const button=node('button','下载 MD');button.addEventListener('click',()=>download(article).catch(error=>toast(error.message)));row.append(button);panel.append(row);}
    $('cabin-state').textContent=batchStatusLabel(b);$('status-task').textContent=`${b.completed}/${b.total}`;
    const apiCounter=document.querySelector('.geo-status-list > div:last-child dd');apiCounter.textContent=`${b.requests} 次请求步骤`;
    renderConnections();
  }
  async function drive(b) {
    if(driving)return;driving=true;pauseRequested=false;$('run-task').disabled=true;
    try{
      while(!pauseRequested&&b.status==='ready'&&!b.pauseRequested){
        renderBatch(b);
        try{const response=await api(`batches/${b.id}/run`,{seq:b.seq,maxSteps:1});b=response.batch;
          if(b.error&&b.status==='ready')await new Promise(resolve=>setTimeout(resolve,response.nextPollMs||1200));
        }catch(error){if(error.code!=='STEP_CLAIMED')throw error;
          const latest=await api('batches/'+b.id);if(latest.seq===b.seq){b=latest;toast('其他执行器正在处理当前步骤，未重复提交。稍后可读取最新状态。');break;}b=latest;
        }
      }
      b=await api('batches/'+b.id);renderBatch(b);
    }catch(error){toast(error.message);}
    finally{driving=false;$('run-task').disabled=false;if(csrf){try{activeBatch=await api('batches/'+b.id);await refreshSettings();renderBatch(activeBatch);await history();}catch(error){toast(error.message);}}}
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
      const row=node('article',undefined,'runtime-panel runtime-history');row.append(node('h2',b.title),node('p',`${b.model.label} · ${b.completed}/${b.total} 篇 · ${batchStatusLabel(b)}`));
      const button=node('button','打开批次');button.addEventListener('click',async()=>{if(driving){toast('请先暂停当前批次。');return;}try{renderBatch(await api('batches/'+b.id));changeView('workspace');$('batch-progress').scrollIntoView({behavior:'smooth',block:'center'});}catch(error){toast(error.message);}});row.append(button);list.append(row);
      if(b.completed){const group=node('article',undefined,'runtime-panel');group.append(node('h2',`${b.title} · ${b.completed} 篇已通过审核`));const load=node('button','展开文章下载');load.addEventListener('click',async()=>{load.disabled=true;try{const detail=await api('batches/'+b.id);for(const article of detail.articles){const entry=node('div',undefined,'runtime-article');entry.append(node('span',article.title));const d=node('button','下载 MD');d.addEventListener('click',()=>download(article).catch(error=>toast(error.message)));entry.append(d);group.append(entry);}load.remove();}catch(error){load.disabled=false;toast(error.message);}});group.append(load);completed.append(group);}
    }
    if(!completed.childElementCount)completed.append(node('p','还没有通过审核的文章。','runtime-panel'));
  }
  document.querySelectorAll('[data-view="history"],[data-view="completed"]').forEach(button=>button.addEventListener('click',()=>history().catch(e=>toast(e.message))));
  document.querySelectorAll('[data-view="settings"]').forEach(button=>button.addEventListener('click',()=>refreshSettings().then(()=>loadMembers()).catch(e=>toast(e.message))));
  let tabAuthenticated=false;try{tabAuthenticated=sessionStorage.getItem(AUTH_TAB_MARKER)==='1';}catch{}
  if(shouldRestoreSession({navigationType:performance.getEntriesByType('navigation')[0]?.type,tabAuthenticated,hash:location.hash})){
    const operation=auth.begin();
    api('auth/session').then(data=>acceptSession(operation,data)).catch(error=>{
      if(error.code==='STALE_RESPONSE')return;showLogin();message('login-message',error.code==='LOGIN_REQUIRED'?'请输入账号和密码。':error.message,error.code!=='LOGIN_REQUIRED');
    });
  }else{showLogin();message('login-message','请输入账号和密码，点击登录后进入工作台。');}
  window.addEventListener('pageshow',event=>{if(event.persisted){showLogin();message('login-message','请重新输入密码后进入工作台。');}});
}
