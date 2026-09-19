import { getModelPresentation } from './model-switch.js';
import { AUTH_TAB_MARKER, accountScopeFrom, createAuthFlow, shouldRestoreSession } from './auth-flow.js';
import {createBatchRunners} from './batch-runners.js';
import {initializeWorkspaces} from './workspace-ui.js';
import {initializeConsole} from './console-view.js';
import {createLocalOutput} from './local-output.js';
import {createArticleDelivery} from './article-delivery.js';

export function modelIsLocked(settings,batch) {
  return Boolean(settings?.modelLocked || batch && !['completed','cancelled'].includes(batch.status));
}
export function batchStatusLabel(batch) {
  if(batch.status==='completed')return batch.failedTasks?.length?'已结束 · 部分任务未完成':'全部完成';
  return {cancelled:'已取消',paused:'已暂停',failed:'需要处理',awaiting_save:'等待保存到本机'}[batch.status] || (batch.pauseRequested?'正在暂停':batch.phaseLabel);
}
export function pendingOperation(previous,values,makeId=()=>crypto.randomUUID()) {
  const signature=JSON.stringify(values);
  return previous?.signature===signature?previous:{signature,body:{...values,idempotencyKey:makeId()}};
}
function localDateTime(value) {const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
async function downloadBytes(artifactId) {
  const response=await fetch('/api/artifacts/'+encodeURIComponent(artifactId),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(125000)});
  if(!response.ok){let data={};try{data=await response.json();}catch{}throw Object.assign(new Error(data.error||'文章文件读取失败。'),{status:response.status,code:data.code});}
  return new Uint8Array(await response.arrayBuffer());
}

const $ = id => document.getElementById(id);
function node(tag, text, className) { const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n; }
function message(id,text,error=false) { $(id).textContent=text;$(id).classList.toggle('is-error',error); }
async function download(article,isCurrent=()=>true) {
  if(article.artifactId){
    const response=await fetch('/api/artifacts/'+encodeURIComponent(article.artifactId),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(125000)});
    if(!response.ok){let data={};try{data=await response.json();}catch{}throw new Error(data.error||'文章文件读取失败。');}
    const blob=await response.blob();if(!isCurrent())return;const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=article.filename||`article-${article.index}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
  }
  const url=URL.createObjectURL(new Blob([article.markdown],{type:'text/markdown;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`${article.index}-${article.brand}-${article.title}`.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,120)+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function bootstrapAuthenticatedWorkspace({showWorkspace,refreshSettings,loadHistory,showServiceFailure}) {
  showWorkspace();
  try {await refreshSettings();await loadHistory();return true;}
  catch(error) {showServiceFailure(error);return false;}
}
export function initializeRuntime({renderSelectedModel,changeView,getUploads,clearUploads=()=>{},getDraftUploads,restoreDraftUploads,uploadsAreReading,getQuestionDocs=()=>[],onUploadsChange}) {
  let csrf='',settings=null,activeBatch=null,pendingCredit=null,members=[],workspaces;
  const auth=createAuthFlow();
  const consoleView=initializeConsole({changeView,onCreate:()=>workspaces.create().then(()=>{historyLoadedAt=0;})});
  const localOutput=createLocalOutput({});
  const delivery=createArticleDelivery({api,download:downloadBytes,localOutput,onPendingChange:renderSavingPending,onBatch:b=>receiveBatch(b)});
  function renderSaving() {
    const pane=$('saving-settings');if(!pane)return;
    const operation=auth.epoch;
    pane.replaceChildren(node('h2','文章保存到本机'),
      node('p','选择一个本机文件夹后，生成完成的文章会自动写入并逐字校验；确认保存成功前，网站不会清理在线正文。'),
      node('p','文件夹授权只保存在本浏览器中，并按登录账号相互隔离。忘记此设备目录不会删除已保存的文章。','runtime-hint'));
    const statusLine=node('p',undefined,'runtime-hint');statusLine.id='saving-status';statusLine.setAttribute('role','status');
    const messageLine=node('p',undefined,'runtime-hint');messageLine.id='saving-message';
    pane.append(statusLine,messageLine);
    // 先从浏览器 IndexedDB 恢复本账号上次选择的文件夹句柄，再取状态渲染
    localOutput.restore().catch(()=>null).then(()=>localOutput.state()).then(state=>{
      if(!auth.isCurrent(operation))return;
      if(!state.supported){
        statusLine.textContent='当前浏览器不支持自动保存到本地目录。可继续查看历史和手动下载文件；正式使用请用最新版桌面 Edge 或 Chrome。';
        return;
      }
      if(!state.scope){statusLine.textContent='登录后即可选择本机保存文件夹。';return;}
      const button=node('button',state.directoryName?'更换文件夹':'选择文件夹','geo-run-button');button.type='button';button.id='saving-pick';
      button.addEventListener('click',async()=>{
        button.disabled=true;messageLine.textContent='';messageLine.classList.remove('is-error');
        try{
          const picked=await localOutput.pick();
          if(picked?.cancelled)messageLine.textContent='已取消选择，保持原设置。';
        }catch(error){messageLine.textContent=error.message||'选择文件夹失败。';messageLine.classList.add('is-error');}
        finally{button.disabled=false;renderSaving();}
      });
      pane.append(button);
      if(!state.directoryName){statusLine.textContent='尚未选择本机保存文件夹。新文章生成前需要先完成目录授权。';return;}
      const authorized=state.permission==='granted';
      statusLine.textContent=`保存文件夹：${state.directoryName} · ${authorized?'已授权':'需要重新授权'}`;
      messageLine.before(node('p',`保存路径：本机「${state.directoryName}」文件夹。浏览器安全限制不显示完整磁盘路径，文章按问句命名，直接保存在该文件夹中，可在文件管理器里找到它。`,'runtime-hint'));
      if(!authorized){
        const authorize=node('button','重新授权','geo-run-button');authorize.type='button';authorize.id='saving-authorize';
        authorize.addEventListener('click',async()=>{
          authorize.disabled=true;
          try{
            const result=await localOutput.requestAccess();
            messageLine.textContent=result==='granted'?'已重新授权此文件夹。':'授权被拒绝，稍后写盘前需要再次授权。';
          }catch(error){messageLine.textContent=error.message||'重新授权失败。';messageLine.classList.add('is-error');}
          finally{authorize.disabled=false;renderSaving();}
        });
        pane.append(authorize);
      }
      const forget=node('button','忘记此设备目录','console-link-button');forget.type='button';forget.id='saving-forget';
      forget.addEventListener('click',async()=>{
        if(!confirm('忘记此设备上保存的文件夹设置？已写入本机的文章文件不会被删除。'))return;
        await localOutput.forget();renderSaving();
      });
      pane.append(forget);
    });
    const pendingWrap=node('div');pendingWrap.id='saving-pending-wrap';
    pane.append(pendingWrap);
    renderSavingPending();
  }
  function renderSavingPending() {
    const wrap=$('saving-pending-wrap');if(!wrap)return;
    wrap.replaceChildren();
    const count=delivery.pendingCount;
    const line=node('p',undefined,'runtime-hint');line.setAttribute('role','status');wrap.append(line);
    if(count===null){line.textContent='待补存文章：读取中…';return;}
    if(!count){line.textContent='待补存文章：没有。新文章写盘并确认后，服务器才会清理在线正文。';return;}
    line.textContent=`待补存文章：${count} 篇。写盘并确认成功前，在线正文不会清理。`;
    const button=node('button','立即保存到本机','geo-run-button');button.type='button';button.id='saving-deliver';
    button.addEventListener('click',async()=>{
      button.disabled=true;
      try{
        const result=await delivery.deliverAll();
        if(!result.skipped){
          if(result.failed.length)toast(`有 ${result.failed.length} 篇未能确认保存，请稍后重试。`);
          else if(result.delivered)toast(`已保存 ${result.delivered} 篇文章到本机并确认。`);
        }
      }catch(error){toast(error.message||'保存失败。');}
      finally{button.disabled=false;renderSavingPending();}
    });
    wrap.append(button);
  }
  function downloadCurrent(article){const operation=auth.epoch;return download(article,()=>auth.isCurrent(operation));}
  const runners=createBatchRunners({api,onBatch:receiveBatch,onError:(error,id)=>toast(`任务 ${id.slice(0,6)}：${error.message}`),async onFinish(id){
    const operation=auth.epoch;
    try{receiveBatch(await api('batches/'+id));await refreshSettings();await history();delivery.sync().catch(()=>{});}
    catch(error){if(auth.isCurrent(operation)&&error.code!=='STALE_RESPONSE')toast(error.message);}
  }});
  workspaces=initializeWorkspaces({api,getSettings:()=>settings,getDraftUploads,restoreDraftUploads,uploadsAreReading,onUploadsChange,changeView,consoleView,
    onMutated(){historyLoadedAt=0;},
    onSelect(w){activeBatch=w?.batch||null;consoleView?.setWorkspaceEmpty(!w);if(activeBatch)renderBatch(activeBatch);else{$('batch-progress').replaceChildren();consoleView?.setBatch(null);}},
    onModelChange:renderConnections,onStarted:drive,onError:error=>toast(error.message),onSuccess(){ $('runtime-toast').hidden=true; }});
  document.querySelector('[data-view-panel=settings]').addEventListener('directorychange',event=>{if(event.detail==='saving')renderSaving();});
  const actions=new WeakMap();
  const rememberTab=value=>{try{if(value)sessionStorage.setItem(AUTH_TAB_MARKER,'1');else sessionStorage.removeItem(AUTH_TAB_MARKER);}catch{}};
  let expiryTimer;
  const shell=document.querySelector('.geo-shell');
  function showLogin() {
    document.documentElement.classList.remove('booting');
    auth.invalidate();runners.reset();workspaces.reset();rememberTab(false);clearTimeout(expiryTimer);csrf='';settings=null;activeBatch=null;pendingCredit=null;members=[];
    localOutput.setScope(null);delivery.setScope(null);renderSaving();
    shell.hidden=true;$('login-page').hidden=false;$('login-password').value='';$('login-password').type='password';$('toggle-password').textContent='显示';$('toggle-password').setAttribute('aria-pressed','false');$('toggle-password').setAttribute('aria-label','显示密码');
    $('model-form').reset();$('ima-form').reset();$('member-form').reset();$('credit-form').reset();$('subscription-form').reset();defaultMemberDates();clearUploads();
    for(const id of ['batch-progress','history-list','completed-list','managed-user','managed-user-summary','member-ledger','own-ledger'])$(id).replaceChildren();
    $('tenant-admin').hidden=true;document.querySelector('.ima-admin').hidden=true;$('batch-progress').hidden=true;$('runtime-toast').hidden=true;renderModelLock();
    const submit=document.querySelector('.login-submit');actions.delete(submit);submit.disabled=false;
    consoleView?.reset();
  }
  function toast(text) {if(!csrf)return;message('runtime-toast',text,true);$('runtime-toast').hidden=false;}
  async function api(path,body) {
    const operation=auth.epoch;
    let response;
    try {response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(125000)});}
    catch {if(!auth.isCurrent(operation))throw Object.assign(new Error('已忽略旧会话响应。'),{code:'STALE_RESPONSE'});throw new Error('连接中断或请求超时，未自动重试。批次可在历史记录中读取进度。');}
    if(!auth.isCurrent(operation))throw Object.assign(new Error('已忽略旧会话响应。'),{code:'STALE_RESPONSE'});
    let data;try{data=await response.json();}catch{
      // 网关超时/崩溃会返回非 JSON（HTML 错误页），与"接口未部署(404)"区分开，不再误导排查方向。
      if(response.status===404)throw new Error('运行接口未部署，请管理员检查 EdgeOne 的 Python Cloud Functions 与 PostgreSQL 配置。');
      throw new Error(`运行接口返回异常（HTTP ${response.status||'无状态'}），请稍后重试；若反复出现请联系管理员检查部署与执行时限。`);
    }
    if(!auth.isCurrent(operation))throw Object.assign(new Error('已忽略旧会话响应。'),{code:'STALE_RESPONSE'});
    if(!response.ok){if(response.status===401&&path!=='auth/login')showLogin();const e=new Error(data.error||'请求失败。');e.code=data.code;e.status=response.status;throw e;}
    return data;
  }
  function selected() {const input=document.querySelector('input[name="model-option"]:checked');return getModelPresentation(input.dataset.provider,input.dataset.slot);}
  function renderCredentials() {
    const choice=selected(),configured=Boolean(settings?.providers[choice.id]?.configured);
    $('credential-provider').textContent=`当前编辑：${choice.provider} · ${choice.model}${configured?' · 已保存密钥':' · 尚未配置'}`;
    $('custom-model-id').placeholder=`留空使用 ${choice.modelId}`;
    document.querySelectorAll('[data-picker-provider]').forEach(n=>n.textContent=choice.provider);
    document.querySelectorAll('[data-picker-model]').forEach(n=>n.textContent=choice.model);
    document.querySelectorAll('[data-picker-status]').forEach(n=>n.textContent=configured?'已配置':'未配置');
    document.querySelectorAll('[data-picker-logo]').forEach(n=>{n.src=choice.logo;});
    document.querySelectorAll('.geo-provider-card').forEach(card=>{const provider=card.querySelector('input').dataset.provider;card.querySelector('.geo-provider-card__status').textContent=settings?.providers[provider]?.configured?'已配置':'未配置';});
  }
  function renderConnections() {
    if(!settings)return;
    const model=activeBatch?.model||workspaces.model||settings.model,configured=settings.providers[model.id].configured;
    document.querySelectorAll('[data-selected-model-provider]').forEach(n=>n.textContent=model.provider);
    document.querySelectorAll('[data-selected-model-name]').forEach(n=>n.textContent=model.model);
    document.querySelectorAll('[data-selected-model-preflight]').forEach(n=>n.textContent=`${model.label} · ${configured?'已配置':'未配置 API'}`);
    document.querySelectorAll('[data-selected-model-service]').forEach(n=>n.textContent=`${model.provider} · ${configured?'已配置':'未配置'}`);
    document.querySelectorAll('[data-selected-model-status]').forEach(n=>n.textContent=configured?'已配置':'未配置');
    document.querySelectorAll('[data-selected-model-label]').forEach(n=>{n.textContent=activeBatch?.model.label||model.label;n.title=n.textContent;});
    document.querySelectorAll('[data-selected-model-connection]').forEach(n=>n.textContent=`已保存：${model.label} · ${configured?'已配置':'未配置'}`);
    document.querySelectorAll('[data-ima-status]').forEach(n=>n.textContent=settings.ima.configured?'IMA · 已配置':'IMA · 等待管理员配置');
    document.querySelectorAll('[data-verify-model]').forEach(n=>n.textContent=`${settings.model.label} · ${settings.providers[settings.model.id].configured?'已配置':'未配置'}`);
    document.querySelectorAll('[data-verify-ima]').forEach(n=>n.textContent=settings.ima.configured?'缓存已就绪':'等待管理员配置');
    document.querySelectorAll('[data-question-model]').forEach(n=>n.textContent=settings.model.label);
    document.querySelectorAll('[data-ima-badge-status]').forEach(n=>n.textContent=settings.ima.configured?'已配置':'未配置');
    const chip=document.querySelector('.geo-service-chips > span');chip.textContent=settings.ima.configured?'IMA · 已配置':'IMA · 未配置';
    const expiry=settings.ima.expiresAt;
    $('ima-expiry').textContent=expiry?`到期日期：${expiry}${Date.parse(expiry)-Date.now()<7*86400000?' · 即将到期或已过期，请管理员更新':''}`:'到期日期尚未登记。共享凭据由管理员维护。';
    document.querySelectorAll('[data-credit-balance]').forEach(n=>n.textContent=`积分：${settings.credits?.balance??'—'}`);
    document.querySelectorAll('[data-subscription-expiry]').forEach(n=>n.textContent=settings.subscription?.expiresAt?`有效期至：${new Date(settings.subscription.expiresAt).toLocaleDateString('zh-CN')}`:'有效期：未配置');
    const owner=settings.subscription?.role==='owner';$('tenant-admin').hidden=!owner;document.querySelector('.ima-admin').hidden=!owner;
    consoleView?.setOwner(owner);
    const days=Math.ceil((Number(settings.subscription?.expiresAt)-Date.now())/86400000);
    const reminder=!settings.subscription?.active?'服务尚未生效或已到期，请联系管理员调整有效期。已有文章仍可下载。':days<=7?`服务将在 ${Math.max(0,days)} 天内到期，请及时联系管理员续期。`:'服务有效，每条有效任务预扣 1 积分，未完整输出的任务自动返还。';
    message('subscription-reminder',reminder,!settings.subscription?.active || days<=3);
    renderModelLock();
  }
  function renderModelLock() {const locked=modelIsLocked(settings,activeBatch);document.querySelectorAll('input[name="model-option"], #model-key, #custom-model-id, #model-form button').forEach(input=>{input.disabled=locked;});}
  async function refreshSettings() {settings=await api('settings');renderSelectedModel(settings.model.id,settings.model.slot);$('custom-model-id').value=settings.model.modelId===getModelPresentation(settings.model.id,settings.model.slot).modelId?'':settings.model.modelId;renderCredentials();workspaces.modelOptions();renderConnections();if(!ownLedgerLoaded){ownLedgerLoaded=true;loadOwnLedger().catch(()=>{});}}
  async function enter() {return bootstrapAuthenticatedWorkspace({
    showWorkspace(){ document.documentElement.classList.remove('booting');$('login-page').hidden=true;shell.hidden=false;$('login-password').value=''; },
    refreshSettings,
    async loadHistory(){await history();await loadMembers();},
    showServiceFailure(error){if(error.code!=='STALE_RESPONSE')toast(error.message);},
  });}
  async function acceptSession(operation,data) {
    if(!auth.isCurrent(operation))return;
    if(!auth.accept(operation,data))throw new Error('登录响应无效，请重新输入账号和密码。');
    csrf=data.csrf;rememberTab(true);clearTimeout(expiryTimer);
    localOutput.setScope(accountScopeFrom(data));
    delivery.setScope(accountScopeFrom(data));
    delivery.sync().catch(()=>{});
    renderSaving();
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
    if(runners.size){toast('请先分别暂停运行中的工作区，等待当前步骤结束后退出。');return;}
    if(!confirm('确认退出工作台？模型设置、批次历史和已完成文章仍保存在当前账号中。'))return;
    try{await workspaces.flush();}catch(error){toast(error.message);return;}
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
  $('refresh-ima-cache').addEventListener('click',event=>action(event.currentTarget,'ima-cache-message',async()=>{
    // 分批续跑：start 开新代并刷新目录清单，循环拉取文件正文（每次限量），
    // 避免单请求全量抓取撞网关执行时限。中断后再次点击可继续，不重复下载。
    if(!confirm('将分批重新拉取 copilot 知识库全部内容与 GEO优化知识库列表写入共享缓存。期间请保持页面打开直至完成；运行中的批次不受影响。')){message('ima-cache-message','已取消。');return;}
    let result=await api('ima/cache/refresh',{start:true});
    let rounds=0;
    while(!result.done&&rounds<100){
      rounds++;
      message('ima-cache-message',`正在更新共享缓存：copilot 共 ${result.copilotFiles} 个文件，已处理 ${result.copilotTotal} 个（本次下载 ${result.fetchedThisCall} 个）…`);
      result=await api('ima/cache/refresh',{});
    }
    for(const warning of result.warnings||[])toast(warning);
    if(!result.done){message('ima-cache-message','更新尚未完成，请再次点击“更新获取 IMA 缓存”继续。',true);return;}
    message('ima-cache-message',`缓存更新完成：copilot 已更新 ${result.copilotFiles} 个文件，GEO优化知识库列表 ${result.geoListed} 项。后续任务直接使用新缓存。`);
  }));
  // 问句板块：上传公司文档 → 模型判断行业 → 联网挖掘问句 → 九大维度排序；预扣 1 积分，失败返还。
  let lastQuestionResult=null;
  async function saveQuestionMarkdown(result){
    const now=new Date(),pad=n=>String(n).padStart(2,'0');
    const stamp=`${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const name=`问句查询-${result.analysis.industry}-${stamp}.md`;
    await localOutput.saveFile([],name,result.markdown);
  }
  function renderQuestions(result){
    lastQuestionResult=result;
    const panel=$('question-results');if(!panel)return;
    panel.hidden=false;
    const analysis=$('question-analysis');
    const products=result.analysis.products?.length?` · 主要产品：${result.analysis.products.join('、')}`:'';
    analysis.textContent=`行业判断：${result.analysis.industry} · 核心业务：${result.analysis.business||'—'}${products} · 目标客户：${result.analysis.audience||'—'}`;
    const list=$('question-list');list.replaceChildren();
    result.questions.forEach((item,index)=>{
      const row=node('li',undefined,'question-item');
      row.append(node('strong',`${index+1}. ${item.question}`));
      row.append(node('span',`${item.intent} · ${item.stage} · 评分 ${item.score}${item.reason?` · ${item.reason}`:''}`,'question-item__meta'));
      list.append(row);
    });
  }
  // 查询进度条：单请求内按阶段提示（读取文档→模型判行业→联网搜索→生成排序）。
  let questionProgressTimer=null;
  function startQuestionProgress(){
    const panel=$('question-progress');if(!panel)return;
    panel.hidden=false;
    const fill=$('question-progress-fill'),text=$('question-progress-text');
    const stages=['正在读取公司文档…','模型正在判断行业与核心业务…','正在联网搜索行业问句线索…','正在按九大维度生成并排序问句…'];
    let stage=0;text.textContent=stages[0];fill.style.width='8%';
    if(questionProgressTimer)clearInterval(questionProgressTimer);
    questionProgressTimer=setInterval(()=>{
      stage=Math.min(stage+1,stages.length-1);
      text.textContent=stages[stage];
      fill.style.width=Math.min(90,8+stage*24)+'%';
    },7000);
  }
  function stopQuestionProgress(done){
    if(questionProgressTimer){clearInterval(questionProgressTimer);questionProgressTimer=null;}
    const panel=$('question-progress');if(!panel)return;
    if(done){
      $('question-progress-fill').style.width='100%';
      $('question-progress-text').textContent='查询完成。';
      setTimeout(()=>{panel.hidden=true;},1500);
    }else panel.hidden=true;
  }
  $('question-run').addEventListener('click',event=>action(event.currentTarget,'question-message',async()=>{
    const docs=getQuestionDocs();
    if(!docs.length)throw new Error('请先上传并成功读取至少 1 份公司文档。');
    const count=Math.floor(Number($('question-count').value));
    if(!Number.isFinite(count)||count<5||count>50)throw new Error('问句数量需在 5-50 之间。');
    startQuestionProgress();
    try{
      const result=await api('questions/discover',{docs,count});
      renderQuestions(result);
      const hint=`已产出 ${result.questions.length} 条问句，预扣 1 积分。`;
      try{await saveQuestionMarkdown(result);message('question-message',`${hint}问句报告已保存到本机文件夹。`);}
      catch(error){message('question-message',`${hint}本机保存未完成：${error.message}，可点击“保存到本机”重试。`);}
      stopQuestionProgress(true);
    }catch(error){stopQuestionProgress(false);throw error;}
  }));
  $('question-save').addEventListener('click',event=>action(event.currentTarget,'question-message',async()=>{
    if(!lastQuestionResult)throw new Error('还没有可保存的查询结果。');
    await saveQuestionMarkdown(lastQuestionResult);
    message('question-message','问句报告已保存到本机文件夹并逐字校验。');
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
  async function loadMembers(preferred){if(settings?.subscription?.role!=='owner')return;
    // Explicit preferred (after create/adjust) wins; an implicit refresh keeps
    // the admin's live selection so a quick credit grant cannot hit the
    // previously selected (owner) account while the list is rebuilding.
    const explicit=preferred!==undefined;
    if(!explicit)preferred=$('managed-user').value;
    members=(await api('tenant/members')).members;const select=$('managed-user');
    const liveSelection=$('managed-user').value;select.replaceChildren();
    for(const member of members){const option=node('option',member.username+(member.role==='owner'?'（总账号）':''));option.value=member.id;select.append(option);}
    const candidates=explicit?[preferred,liveSelection]:[liveSelection,preferred];
    const keepId=candidates.map(id=>members.some(m=>m.id===id)?id:null).find(Boolean)||members[0]?.id;
    if(keepId)select.value=keepId;renderManagedMember();await memberLedger();
  }
  function renderLedger(id,data){const region=$(id);region.replaceChildren();
    if(data.balance!=null&&data.balance!==undefined)region.append(node('p',`当前余额：${data.balance} 积分`,'ledger-summary'));
    if(!data.ledger?.length){region.append(node('p','暂无积分流水。','runtime-hint'));return;}
    const table=node('table'),head=node('thead'),header=node('tr'),body=node('tbody');
    for(const title of ['时间','类型','积分变动','任务']){const th=node('th',title);th.scope='col';header.append(th);}head.append(header);
    const names={grant:'管理员发放',revoke:'管理员收回',reserve:'任务预扣',refund:'未完成返还',release:'释放预扣',consume:'任务完成'};
    for(const entry of data.ledger){const row=node('tr');const amount=Number(entry.amount)||0;const amountTd=node('td',`${amount>0?'+':''}${amount}`);amountTd.className=amount>0?'ledger-in':'ledger-out';for(const value of [new Date(entry.createdAt).toLocaleString('zh-CN'),names[entry.kind]||entry.kind])row.append(node('td',String(value)));row.append(amountTd);row.append(node('td',entry.taskId?`第 ${entry.taskId} 条`:'—'));body.append(row);}
    table.append(head,body);region.append(table,node('p','显示最近 100 条流水。','runtime-hint'));
  }
  async function loadOwnLedger(){renderLedger('own-ledger',await api('credits'));}
  let ownLedgerLoaded=false;
  async function memberLedger(){const userId=$('managed-user').value;if(!userId)return;const data=await api(`tenant/members/${userId}/credits`);if($('managed-user').value===userId)renderLedger('member-ledger',data);}
  $('managed-user').addEventListener('change',()=>{renderManagedMember();memberLedger().catch(e=>toast(e.message));});
  $('refresh-member-ledger').addEventListener('click',event=>action(event.currentTarget,'credit-message',async()=>{await memberLedger();message('credit-message','已读取最新流水。');}));
  $('refresh-own-ledger').addEventListener('click',event=>action(event.currentTarget,'subscription-reminder',async()=>{await loadOwnLedger();await refreshSettings();}));
  $('extend-subscription').addEventListener('click',()=>{const input=$('subscription-form').elements.expiresAt;input.value=localDateTime(Math.max(Date.now(),Date.parse(input.value)||0)+30*86400000);message('subscription-message','已增加 30 天，请点击“保存有效期”生效。');});
  $('subscription-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;action(event.submitter,'subscription-message',async()=>{
    const target=managedMember(),values=Object.fromEntries(new FormData(form));
    await api('tenant/subscription',{userId:target.id,startsAt:new Date(values.startsAt).toISOString(),expiresAt:new Date(values.expiresAt).toISOString()});
    await refreshSettings();await loadMembers(target.id);message('subscription-message',`账号「${target.username}」的有效期已保存。`);
  });});
  function renderBatch(b) {
    if(!csrf||!settings)return;
    const driving=runners.has(b.id);
    activeBatch=b;const panel=$('batch-progress');if(!consoleView)panel.hidden=false;panel.replaceChildren();const workspace=workspaces.forBatch(b.id);consoleView?.setBatch({...b,title:workspace?.draft?.title||workspace?.title||b.title});
    consoleView?.setWorkspaceEmpty(false);
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
        proceed.disabled=true;try{if(b.status==='failed'){if(!confirm('确认重试准备失败的批次？会重新预扣尚未完成任务的积分。'))return;b=await api(`batches/${b.id}/step`,{seq:b.seq,retry:true});}else if(b.status==='paused'){b=await api(`batches/${b.id}/resume`,{});}drive(b);}catch(error){toast(error.message);}finally{proceed.disabled=runners.has(b.id);}
      });controls.append(proceed);
      proceed.disabled=driving||Boolean(b.pauseRequested&&b.status!=='paused');
      if(b.status==='ready'&&!b.pauseRequested){const pause=node('button','暂停后续步骤');pause.addEventListener('click',async()=>{pause.disabled=true;runners.stop(b.id);try{receiveBatch(await api(`batches/${b.id}/pause`,{}));}catch(error){toast(error.message);pause.disabled=false;}});controls.append(pause);}
      const refresh=node('button','读取一次最新状态');refresh.disabled=driving;refresh.addEventListener('click',async()=>{try{receiveBatch(await api('batches/'+b.id));}catch(error){toast(error.message);}});controls.append(refresh);
      if(!driving&&b.status==='ready'){const recover=node('button','处理超时步骤');recover.addEventListener('click',async()=>{if(!confirm('仅处理超过 150 秒无进展的步骤。结果不明的任务会跳过并退款，不重复发送模型请求。'))return;try{receiveBatch(await api(`batches/${b.id}/step`,{seq:b.seq,retry:true}));}catch(error){toast(error.message);}});controls.append(recover);}
      const cancel=node('button','取消批次并返还未完成积分');cancel.addEventListener('click',async()=>{if(!confirm('确认取消？未完整输出的任务积分会返还。已发给模型的请求无法撤回，提供商可能仍计费。'))return;cancel.disabled=true;runners.stop(b.id);try{receiveBatch(await api(`batches/${b.id}/cancel`,{}));await refreshSettings();receiveBatch(await api('batches/'+b.id));await history();}catch(error){toast(error.message);cancel.disabled=false;}});controls.append(cancel);
    }
    panel.append(controls,node('p','切换工作区不会停止其他任务。状态与文件保存在服务端；当前由页面推进，关闭页面可能暂停后续生成，重新打开后可继续。','runtime-hint'));
    renderModelLock();
    consoleView?.renderArticles(b,downloadCurrent,error=>toast(error.message),async()=>{
      const result=await delivery.deliverAll();
      if(!result.skipped&&!result.failed.length&&result.delivered)toast(`已保存 ${result.delivered} 篇文章到本机并确认。`);
      return result;
    });
    $('cabin-state').textContent=batchStatusLabel(b);$('status-task').textContent=`${b.completed}/${b.total}`;
    const apiCounter=document.querySelector('.geo-status-list > div:last-child dd');apiCounter.textContent=`${b.requests} 次请求步骤`;
    renderConnections();
  }
  function receiveBatch(b){
    if(!csrf)return;workspaces.updateBatch(b);
    if(b.status==='awaiting_save'||b.status==='waiting_local')delivery.autoDeliver().catch(error=>console.warn('autoDeliver skipped:',error?.code||'',error?.message||error));
    if(activeBatch?.id===b.id&&!(activeBatch.seq>b.seq)&&!(['completed','cancelled'].includes(activeBatch.status)&&!['completed','cancelled'].includes(b.status)))renderBatch(b);
  }
  function drive(b){
    try{const promise=runners.start(b);receiveBatch(b);if(activeBatch?.id===b.id)consoleView?.detailTab('progress');promise.catch(error=>toast(error.message));}
    catch(error){toast(error.message);}
  }
  $('run-task').addEventListener('click',()=>workspaces.start(getUploads));
  // 空状态与 index.html 里的静态占位保持一致：两页文案不同、无装饰图案，打开页面即时显示。
  function historyEmptyShell(){
    const shell=node('div',undefined,'list-empty list-empty--history');
    shell.dataset.renderKey='empty-history';
    shell.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v4l3 2M21 12a9 9 0 1 1-3-6.7"/></svg>';
    shell.append(node('span','快开始你的内容创作吧！','list-empty-phrase'));
    return shell;
  }
  function completedEmptyShell(){
    const shell=node('div',undefined,'list-empty list-empty--completed');
    shell.dataset.renderKey='empty-completed';
    shell.append(node('span','文章生成后会保存在这里','list-empty-phrase'));
    return shell;
  }
  // 仅当渲染结果与当前内容不同才替换 DOM：数据未变时不重绘，消除"出现又消失"的闪烁。
  function swapList(list,build){
    const fragment=document.createDocumentFragment();
    build(fragment);
    const keyOf=n=>n.dataset.renderKey||`${n.tagName}.${n.className}`;
    const current=[...list.children].map(keyOf);
    const next=[...fragment.children].map(keyOf);
    if(current.length===next.length&&current.every((key,index)=>key===next[index]))return;
    list.replaceChildren(fragment);
  }
  let historyInFlight=null,historyLoadedAt=0;
  function history({force=false}={}) {
    // 登录恢复与视图切换可能并发触发；共享同一次执行，避免清空后重复追加空状态。
    if(historyInFlight)return historyInFlight;
    // 4 秒内的重复视图切换直接复用上次结果：省掉两次网络往返，切换视图即时响应。
    if(!force&&historyLoadedAt&&Date.now()-historyLoadedAt<4000)return Promise.resolve();
    historyInFlight=(async()=>{
    const {batches}=await api('batches');
    historyLoadedAt=Date.now();
    const list=$('history-list'),completed=$('completed-list');
    await workspaces.load(batches);
    // 数据就绪后一次性原子替换，加载期间保留旧内容/静态占位，不再先清空再等待。
    swapList(list,fragment=>{
      if(!batches.length){fragment.append(historyEmptyShell());return;}
      for(const b of batches){
        const row=node('article',undefined,'runtime-panel runtime-history');
        row.dataset.renderKey=`batch:${b.id}:${b.status}:${b.completed}`;
        row.append(node('h2',b.title),node('p',`${b.model.label} · ${b.completed}/${b.total} 篇 · ${batchStatusLabel(b)}`));
        const button=node('button','打开批次');button.addEventListener('click',()=>openBatch(b));row.append(button);
        fragment.append(row);
      }
    });
    swapList(completed,fragment=>{
      for(const b of batches){
        if(!b.completed)continue;
        const group=node('article',undefined,'runtime-panel');
        group.dataset.renderKey=`done:${b.id}:${b.completed}`;
        group.append(node('h2',`${b.title} · ${b.completed} 篇已通过审核`));
        const load=node('button','展开文章下载');load.addEventListener('click',async()=>{load.disabled=true;try{const detail=await api('batches/'+b.id);for(const article of detail.articles){const entry=node('div',undefined,'runtime-article');entry.append(node('span',article.title));const d=node('button','下载 MD');d.addEventListener('click',()=>downloadCurrent(article).catch(error=>toast(error.message)));entry.append(d);group.append(entry);}load.remove();}catch(error){load.disabled=false;toast(error.message);}});group.append(load);
        fragment.append(group);
      }
      if(!fragment.childElementCount)fragment.append(completedEmptyShell());
    });
    consoleView?.renderOverview([...workspaces.summaries,...batches.filter(b=>!workspaces.forBatch(b.id))],b=>b.workspaceId?workspaces.open(b.workspaceId):openBatch(b));
    })().catch(error=>{historyLoadedAt=0;throw error;}).finally(()=>{historyInFlight=null;});
    return historyInFlight;
  }
  async function openBatch(b){const workspace=workspaces.forBatch(b.id);if(workspace)return workspaces.open(workspace.id);return workspaces.leave(async()=>{renderBatch(await api('batches/'+b.id));changeView('workspace');consoleView?.detailTab('progress');});}
  $('refresh-overview')?.addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{await history({force:true});}catch(error){toast(error.message);}finally{button.disabled=false;}});
  document.querySelectorAll('[data-view="overview"],[data-view="history"],[data-view="completed"]').forEach(button=>button.addEventListener('click',()=>history().catch(e=>toast(e.message))));
  document.querySelectorAll('[data-view="settings"],[data-view="admin"]').forEach(button=>button.addEventListener('click',()=>refreshSettings().then(()=>loadMembers()).catch(e=>toast(e.message))));
  let tabAuthenticated=false;try{tabAuthenticated=sessionStorage.getItem(AUTH_TAB_MARKER)==='1';}catch{}
  if(shouldRestoreSession({navigationType:performance.getEntriesByType('navigation')[0]?.type,tabAuthenticated,hash:location.hash})){
    const operation=auth.begin();
    api('auth/session').then(data=>acceptSession(operation,data)).catch(error=>{
      if(error.code==='STALE_RESPONSE')return;showLogin();message('login-message',error.code==='LOGIN_REQUIRED'?'请输入账号和密码。':error.message,error.code!=='LOGIN_REQUIRED');
    });
  }else{showLogin();message('login-message','请输入账号和密码，点击登录后进入工作台。');}
  window.addEventListener('pageshow',event=>{if(event.persisted){showLogin();message('login-message','请重新输入密码后进入工作台。');}});
}
