import {getModelPresentation,MODEL_PROVIDER_IDS} from './model-switch.js';

const $=id=>document.getElementById(id);
const terminal=b=>b&&['completed','cancelled'].includes(b.status);
const occupied=w=>w.status==='draft'||w.status==='started'&&!terminal(w.batch);
function el(tag,text,id){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(id)node.id=id;return node;}
function modelValue(model){return `${model.id}:${model.slot}:${model.modelId}`;}
function draftModel(model){const {id,slot,modelId,provider,label}=model;return {id,slot,modelId,provider,label,model:model.model};}

// Coordinates only the currently edited draft. Each running batch has its own driver.
export function initializeWorkspaces({api,getSettings,getDraftUploads,restoreDraftUploads,uploadsAreReading,onUploadsChange,changeView,consoleView,onSelect,onModelChange,onStarted,onError,onSuccess=()=>{}}){
  const records=new Map();let selected=null,busy=false,revision=0,savedRevision=0,epoch=0,restoring=false,conflict=false,uncertain=false;
  let timer,savePromise=null,pendingCreate=null,serverOccupied=0,legacyCount=0,models=[];
  const strip=el('nav',undefined,'workspace-tabs');strip.className='workspace-tabs';strip.setAttribute('aria-label','独立任务工作区');$('geo-main').prepend(strip);
  const toolbar=el('div',undefined,'workspace-toolbar');toolbar.className='workspace-toolbar';
  const titleLabel=el('label','工作区名称'),title=el('input',undefined,'workspace-title');title.type='text';title.name='workspaceTitle';title.id='workspace-title';title.maxLength=160;title.autocomplete='off';titleLabel.append(title);
  const modelLabel=el('label','本工作区模型'),model=el('select',undefined,'workspace-model');model.name='workspaceModel';modelLabel.append(model);
  const controls=el('div');controls.className='workspace-toolbar__actions';
  const save=el('button','保存草稿','save-workspace'),reload=el('button','重新读取','reload-workspace'),close=el('button','关闭草稿','close-workspace');
  for(const button of [save,reload,close])button.type='button';controls.append(save,reload,close);
  const state=el('p','请选择工作区或新建任务。','workspace-save-state');state.setAttribute('role','status');
  toolbar.append(titleLabel,modelLabel,controls,state);
  document.querySelector('.console-detail-tabs').before(toolbar);
  const dirty=()=>selected?.status==='draft'&&revision!==savedRevision;
  const label=w=>w.draft?.title||w.title||'新建任务';
  function status(text,error=false){state.textContent=text;state.classList.toggle('is-error',error);}
  function count(){return Math.max(serverOccupied,[...records.values()].filter(occupied).length+legacyCount);}
  function updateControls(){
    const editable=selected?.status==='draft'&&!uncertain;
    title.disabled=model.disabled=busy||!editable;
    for(const n of document.querySelectorAll('#task-file,#company-files,#company-preview input,#task-preview select'))n.disabled=busy||!editable;
    $('batch-progress').inert=busy;document.querySelector('.geo-workspace').inert=busy||!editable;
    $('run-task').disabled=busy||!editable||conflict;
    save.disabled=busy||!editable||conflict;close.disabled=busy||!editable;reload.disabled=busy||!selected;
    save.hidden=close.hidden=!editable;reload.hidden=!selected;
    $('new-workspace').disabled=busy||count()>=5;
    $('new-workspace').querySelector('small').textContent=`进行中 ${count()} / 5 · ${count()>=5?'已满':'可新建'}`;
    for(const button of strip.children)button.disabled=busy;
  }
  function renderTabs(){
    const all=[...records.values()].filter(w=>w.status!=='archived');
    const shown=all.filter(occupied);
    if(selected&&!shown.some(w=>w.id===selected.id)&&selected.status!=='archived')shown.push(selected);
    for(const w of all)if(shown.length<5&&!shown.some(item=>item.id===w.id))shown.push(w);
    strip.replaceChildren();
    for(const w of shown.slice(0,5)){
      const button=el('button');button.type='button';button.dataset.workspaceId=w.id;
      button.append(el('strong',label(w)),el('small',w.status==='draft'?'草稿':({ready:'运行准备 / 生成',paused:'已暂停',failed:'需要处理',completed:w.batch?.failedTasks?.length?'部分未完成':'已完成',cancelled:'已取消'}[w.batch?.status]||'已启动')));
      if(selected?.id===w.id)button.setAttribute('aria-current','page');
      button.addEventListener('click',()=>operate(()=>select(w.id)));strip.append(button);
    }
    strip.hidden=shown.length===0;updateControls();
  }
  function modelOptions(){
    const settings=getSettings();if(!settings)return;
    const editing=dirty()?models.find(m=>modelValue(m)===model.selectedOptions[0]?.dataset.modelValue):null;
    const chosen=selected?.batch?.model||editing||selected?.draft?.model||settings.model;
    models=[];
    for(const id of MODEL_PROVIDER_IDS)if(settings.providers[id]?.configured)for(const slot of ['primary','secondary'])models.push(draftModel(getModelPresentation(id,slot)));
    for(const extra of [settings.model,chosen])if(!models.some(m=>modelValue(m)===modelValue(extra)))models.push(draftModel(extra));
    model.replaceChildren();
    for(const choice of models){const option=el('option',choice.label+(settings.providers[choice.id]?.configured?'':' · 未配置 API'));option.value=`${choice.id}:${choice.slot}`;if(choice.modelId!==getModelPresentation(choice.id,choice.slot).modelId)option.value+=':'+choice.modelId;option.disabled=!settings.providers[choice.id]?.configured;option.selected=modelValue(choice)===modelValue(chosen);option.dataset.modelValue=modelValue(choice);model.append(option);}
    updateControls();
  }
  function capture(){const choice=models.find(m=>modelValue(m)===model.selectedOptions[0]?.dataset.modelValue)||selected.draft.model;return {...getDraftUploads(),title:title.value.trim()||'新建任务',model:draftModel(choice)};}
  function changed(){
    if(restoring||!selected||selected.status!=='draft')return;
    revision++;status('未保存 · 完成读取后自动加密保存');clearTimeout(timer);
    timer=setTimeout(()=>saveDraft().catch(report),900);
    onModelChange();
  }
  function report(error){if(error.code==='STALE_RESPONSE')return;status(error.message,true);onError(error);}
  async function saveDraft(){
    clearTimeout(timer);
    if(savePromise){await savePromise;return saveDraft();}
    if(!dirty())return selected;
    if(conflict||uncertain)throw new Error('草稿存在版本冲突或启动结果待确认，请先重新读取；本页修改尚未覆盖。');
    const target=selected,snapshot=capture(),version=target.version,ownRevision=revision,operation=epoch;
    status('正在加密保存…');
    const pending=(async()=>{
      try{
        const result=await api(`workspaces/${target.id}/save`,{version,draft:snapshot});
        if(operation!==epoch)return;
        records.set(result.id,result);
        if(selected?.id===result.id){selected=result;savedRevision=ownRevision;status(dirty()?'仍有修改待保存':'已保存 · 选中的工作表与完整文档已加密');if(!dirty()){document.querySelector('[data-view-panel=workspace] h1').textContent=label(result);onSuccess();}}
        renderTabs();return result;
      }catch(error){if(operation===epoch&&error.code==='WORKSPACE_VERSION_CONFLICT'){conflict=true;updateControls();}throw error;}
      finally{if(operation===epoch&&savePromise===pending)savePromise=null;}
    })();
    savePromise=pending;return pending;
  }
  async function flush(){await saveDraft();if(dirty())await saveDraft();}
  async function operate(fn){
    if(busy)return;const operation=epoch;busy=true;updateControls();
    try{await fn();}catch(error){if(operation===epoch)report(error);}
    finally{if(operation===epoch){busy=false;updateControls();}}
  }
  function display(w){
    restoring=true;selected=w;revision=savedRevision=0;conflict=uncertain=false;clearTimeout(timer);
    try{
      if(w)records.set(w.id,w);
      restoreDraftUploads(w?.draft||{});title.value=w?.draft?.title||w?.title||'';onSelect(w);
      if(w?.batch){consoleView?.setBatch({...w.batch,title:label(w)});consoleView?.detailTab('progress');status('已启动 · 资料与模型已锁定');}
      else{consoleView?.setBatch(null);consoleView?.detailTab('materials');status(w?'已保存 · 自动保存选中的工作表和完整文档':'请选择工作区或新建任务。');}
      if(w&&!w.batch)document.querySelector('[data-view-panel=workspace] h1').textContent=label(w);
      modelOptions();renderTabs();onModelChange();onSuccess();
    }finally{restoring=false;}
  }
  async function select(id){
    if(uploadsAreReading())throw new Error('文件仍在读取，请稍候再切换工作区。');
    await flush();const w=await api(`workspaces/${id}`);display(w);changeView('workspace');
  }
  async function load(batches=[]){
    const data=await api('workspaces');
    serverOccupied=data.occupied;
    const incoming=new Map(data.workspaces.map(w=>[w.id,w]));
    if(selected)incoming.set(selected.id,selected);records.clear();for(const [id,w] of incoming)records.set(id,w);
    const linked=new Set(data.workspaces.map(w=>w.batchId));
    legacyCount=batches.filter(b=>!linked.has(b.id)&&!terminal(b)).length;renderTabs();return data.workspaces;
  }
  function updateBatch(batch){
    const old=[...records.values()].find(w=>w.batchId===batch.id);
    if(!old)return;
    if(old.batch&&(old.batch.seq>batch.seq||terminal(old.batch)&&!terminal(batch)))return;
    if(!terminal(old.batch)&&terminal(batch))serverOccupied=Math.max(0,serverOccupied-1);
    const w={...old,batch};records.set(w.id,w);
    if(selected?.id===w.id)selected=w;renderTabs();
  }
  async function create(){
    return operate(async()=>{
      if(uploadsAreReading())throw new Error('文件仍在读取，请稍候再新建工作区。');
      await flush();pendingCreate??=crypto.randomUUID();
      status('正在创建…');state.setAttribute('aria-busy','true');
      let result;
      try{result=await api('workspaces',{requestId:pendingCreate});}
      catch(error){if(error.status>=400&&error.status<500)pendingCreate=null;throw error;}
      finally{state.removeAttribute('aria-busy');}
      pendingCreate=null;serverOccupied++;display(result);changeView('workspace');
      setTimeout(()=>{if(selected?.id===result.id&&!title.disabled)title.focus();},0);
    });
  }
  $('new-workspace').addEventListener('click',()=>{create().catch(()=>{});});
  save.addEventListener('click',()=>operate(flush));
  reload.addEventListener('click',()=>operate(async()=>{if((dirty()||uncertain)&&!confirm('重新读取会丢弃本页尚未保存的修改，读取服务器最新资料与启动状态。确认继续？'))return;if(savePromise)await savePromise.catch(()=>{});display(await api('workspaces/'+selected.id));}));
  close.addEventListener('click',()=>operate(async()=>{
    if(!confirm('关闭此草稿？不会启动任务或扣分，未保存修改会被放弃。'))return;
    if(savePromise)await savePromise;
    const result=await api(`workspaces/${selected.id}/archive`,{version:selected.version});records.set(result.id,result);serverOccupied=Math.max(0,serverOccupied-1);display(null);changeView('overview');
  }));
  title.addEventListener('input',changed);model.addEventListener('change',changed);onUploadsChange(changed);
  window.addEventListener('beforeunload',event=>{if(dirty()||savePromise){event.preventDefault();event.returnValue='';}});
  async function start(validate){
    return operate(async()=>{
      if(selected?.status!=='draft')throw new Error('请先新建并选择一个草稿工作区。');
      validate();await flush();const target=selected;
      let result;
      try{result=await api(`workspaces/${target.id}/start`,{version:target.version});}
      catch(error){
        if(!error.status&&error.code!=='STALE_RESPONSE'){uncertain=true;error.message='启动结果待确认，请重新读取此工作区，不要再次提交。';}
        throw error;
      }
      display(result);onStarted(result.batch);
    });
  }
  function reset(){epoch++;clearTimeout(timer);savePromise=null;pendingCreate=null;records.clear();selected=null;busy=false;revision=savedRevision=0;serverOccupied=legacyCount=0;conflict=uncertain=false;restoring=true;title.value='';model.replaceChildren();strip.replaceChildren();strip.hidden=true;status('请选择工作区或新建任务。');restoring=false;onSelect(null);updateControls();}
  reset();
  return {load,start,reset,modelOptions,updateBatch,flush,create,open:id=>operate(()=>select(id)),forBatch:id=>[...records.values()].find(w=>w.batchId===id),
    leave:fn=>operate(async()=>{if(uploadsAreReading())throw new Error('文件仍在读取，请稍候再切换。');await flush();display(null);await fn();}),
    get selected(){return selected;},get model(){return selected?.batch?.model||(selected?.status==='draft'?models.find(m=>modelValue(m)===model.selectedOptions[0]?.dataset.modelValue):null);},
    get summaries(){return [...records.values()].filter(w=>w.status!=='archived').map(w=>({...w.batch,id:w.id,workspaceId:w.id,title:label(w),model:w.batch?.model||w.draft?.model||w.model,status:w.batch?.status||'draft',completed:w.batch?.completed||0,total:w.batch?.total||0}));},
  };
}
