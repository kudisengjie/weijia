// Presentation only. Authorization, generation and billing stay in the server/runtime.
const byId=id=>document.getElementById(id);
function el(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
function directory(parent,kind,items){
  const shell=el('div',undefined,'console-directory'),nav=el('nav',undefined,'console-directory__nav'),body=el('div',undefined,'console-directory__body');
  nav.setAttribute('aria-label',kind==='settings'?'个人设置目录':'管理中心目录');
  const panes={};
  for(const [id,label] of items){
    const button=el('button',label);button.type='button';button.dataset[`${kind}Tab`]=id;
    const pane=el('section',undefined,'console-directory__pane');pane.dataset[`${kind}Pane`]=id;panes[id]=pane;
    button.addEventListener('click',()=>select(id));nav.append(button);body.append(pane);
  }
  function select(id){for(const [key,pane] of Object.entries(panes))pane.hidden=key!==id;for(const button of nav.children){const active=button.dataset[`${kind}Tab`]===id;button.classList.toggle('is-selected',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}parent.dispatchEvent(new CustomEvent('directorychange',{detail:id}));}
  shell.append(nav,body);parent.append(shell);select(items[0][0]);return {panes,body,select};
}
export function initializeConsole({changeView,onCreate}){
  const shell=document.querySelector('.geo-shell');
  const settings=document.querySelector('[data-view-panel=settings]'),grid=settings.querySelector('.geo-settings-grid');
  const catalog=grid.querySelector('.geo-model-setting'),credentials=byId('credentials-title').closest('section'),account=byId('account-service'),contact=account.querySelector('.service-contact');
  const shared=byId('ima-title').closest('section'),tenant=byId('tenant-admin');
  const members=byId('member-form'),credits=byId('credit-form'),subscription=byId('subscription-form');
  const picker=el('div',undefined,'console-managed-user');picker.append(byId('managed-user').closest('label'),byId('managed-user-summary'));
  const ledgerButton=byId('refresh-member-ledger'),ledger=byId('member-ledger'),cacheControls=byId('clear-ima-cache').parentElement;
  grid.remove();
  const personal=directory(settings,'settings',[['models','模型与 API'],['security','登录与安全'],['billing','积分与有效期'],['contact','联系与续费']]);
  personal.panes.models.classList.add('geo-settings-grid');personal.panes.models.append(catalog,credentials);
  personal.panes.billing.append(account);personal.panes.contact.append(el('h2','联系零雪'),contact);
  const security=el('div',undefined,'runtime-panel');security.id='security-settings';
  security.append(el('h2','登录与安全'),el('p','新打开登录入口需要主动输入密码；只有已登录的当前标签页刷新，才会向服务器验证并恢复会话。'),el('p','会话最长有效 8 小时。重新登录会替换当前浏览器的旧会话，退出后清除本页的私有资料。'),el('p','请勿在公共电脑保存密码。修改登录密码请联系管理员。模型密钥始终加密存储在服务器。','runtime-hint'));
  personal.panes.security.append(security);

  const admin=document.querySelector('[data-view-panel=admin]');admin.append(tenant);tenant.replaceChildren();
  const management=directory(tenant,'admin',[['members','子账号管理'],['credits','积分调整'],['subscription','有效期与续期'],['ima','IMA 凭据'],['cache','共享缓存'],['ledger','积分操作记录']]);
  management.body.prepend(picker);
  management.panes.members.append(members);management.panes.credits.append(el('h2','调整账号积分'),credits);management.panes.subscription.append(subscription);
  management.panes.ledger.append(el('h2','所选账号积分记录'),ledgerButton,ledger);
  shared.querySelector('.ima-admin').open=true;management.panes.ima.append(shared);
  management.panes.cache.append(el('h2','共享 IMA 缓存'),el('p','缓存由站点统一维护。只有你主动清除后，新任务才重新获取所需资料；运行中的任务继续使用已锁定的资料版本。'),cacheControls);
  tenant.addEventListener('directorychange',event=>{picker.hidden=!['credits','subscription','ledger'].includes(event.detail);});picker.hidden=true;

  const workspace=document.querySelector('[data-view-panel=workspace]'),uploads=workspace.querySelector('.geo-workspace'),progress=byId('batch-progress');
  const materials=el('div',undefined,'workspace-materials'),materialSummary=el('section',undefined,'runtime-panel');materialSummary.id='workspace-materials-summary';materialSummary.hidden=true;
  let currentBatch=null,workspaceEmpty=true;
  const emptyState=el('div',undefined,'workspace-empty');emptyState.id='workspace-empty';emptyState.hidden=true;
  const emptyCreate=el('button','新建任务','workspace-empty__create');emptyCreate.type='button';emptyCreate.id='empty-create';
  emptyCreate.addEventListener('click',()=>{emptyCreate.disabled=true;Promise.resolve(onCreate?.()).catch(()=>{}).finally(()=>{emptyCreate.disabled=false;});});
  emptyState.append(el('strong','从这里开始新的 GEO 任务'),
    el('p','先新建一个任务工作区：上传 Excel 任务表与公司资料，保存为草稿后即可启动生成。每个账号最多保留五个未结束工作区。'),
    emptyCreate);
  workspace.insertBefore(materials,uploads);materials.append(uploads,materialSummary);materials.before(emptyState);
  const tabbar=el('nav',undefined,'console-detail-tabs');tabbar.setAttribute('aria-label','当前工作区内容');
  const articles=el('section',undefined,'runtime-panel');articles.id='workspace-articles';articles.hidden=true;
  const detailPanes={materials,progress,articles};
  function detailTab(id){
    for(const [key,pane] of Object.entries(detailPanes))pane.hidden=key!==id;
    for(const button of tabbar.children){const active=button.dataset.detailTab===id;button.classList.toggle('is-selected',active);button.setAttribute('aria-pressed',String(active));}
  }
  for(const [id,label] of [['materials','资料与任务'],['progress','运行进度'],['articles','文章文件']]){const button=el('button',label);button.type='button';button.dataset.detailTab=id;button.addEventListener('click',()=>detailTab(id));tabbar.append(button);}
  workspace.insertBefore(tabbar,materials);workspace.append(articles);detailTab('materials');
  const title=workspace.querySelector('h1'),copy=workspace.querySelector('.geo-heading p');
  function setBatch(batch){
    currentBatch=batch;
    title.textContent=batch?batch.title:'新建任务';copy.textContent=batch?`${batch.model.label} · 使用固定模型快照，进度和文章单独保存。`:'上传任务表与公司文档，确认品牌和内容后开始。';
    uploads.hidden=Boolean(batch)||workspaceEmpty;materialSummary.hidden=!batch;
    emptyState.hidden=!workspaceEmpty||Boolean(batch);
    if(batch)materialSummary.replaceChildren();
    else renderArticles(null);
    if(batch)materialSummary.append(el('h2','已提交的任务资料'),el('p',`${batch.title} · 计划输出 ${batch.total} 篇文章`),el('p','本批次已使用提交时的 Excel 和公司资料，不能中途替换。请在“运行进度”继续任务，或到“文章文件”下载已保存结果。原始资料暂不在此页重新展开。','runtime-hint'));
  }
  function setWorkspaceEmpty(empty){
    workspaceEmpty=empty;
    emptyState.hidden=!empty||Boolean(currentBatch);
    uploads.hidden=Boolean(currentBatch)||empty;
  }
  function setOwner(owner){shell.dataset.owner=String(owner);document.querySelectorAll('[data-view=admin]').forEach(n=>{n.hidden=!owner;});tenant.hidden=!owner;if(!owner&&shell.dataset.view==='admin')changeView('settings');}
  function renderOverview(batches,open){
    const region=byId('overview-list');region.replaceChildren();
    byId('overview-total').textContent=String(batches.length);
    byId('overview-active').textContent=String(batches.filter(b=>!['completed','cancelled'].includes(b.status)).length);
    byId('overview-articles').textContent=String(batches.reduce((sum,b)=>sum+b.completed,0));
    if(!batches.length){
      const empty=el('div',undefined,'console-empty-state');
      const mascot=document.createElement('img');mascot.src='assets/lxue-geo-founder.png';mascot.alt='';mascot.width=72;mascot.height=72;mascot.loading='lazy';mascot.decoding='async';
      const createButton=el('button','新建任务','console-empty-create');createButton.type='button';createButton.id='overview-create';
      createButton.addEventListener('click',()=>{createButton.disabled=true;Promise.resolve(onCreate?.()).catch(()=>{}).finally(()=>{createButton.disabled=false;});});
      empty.append(mascot,el('strong','还没有任务'),el('p','新建一个工作区，上传 Excel 任务表与公司资料，开始生成文章。'),createButton);
      region.append(empty);return;
    }
    const table=el('table'),head=el('thead'),header=el('tr'),body=el('tbody');
    for(const label of ['任务工作区','模型','状态','文章输出','操作']){const th=el('th',label);th.scope='col';header.append(th);}head.append(header);
    for(const batch of batches){const row=el('tr');const state=batch.status==='completed'?(batch.failedTasks?.length?'部分未完成':'已完成'):({draft:'草稿',paused:'已暂停',failed:'需要处理',cancelled:'已取消'}[batch.status]||batch.phaseLabel||'待运行');
      row.append(el('td',batch.title),el('td',batch.model.label),el('td',state),el('td',`${batch.completed} / ${batch.total}`));
      const action=el('td'),button=el('button','打开工作区','console-link-button');button.type='button';button.addEventListener('click',()=>open(batch));action.append(button);row.append(action);body.append(row);
    }
    table.append(head,body);region.append(table);
  }
  function renderArticles(batch,download,onError){
    articles.replaceChildren(el('h2','已保存文章文件'));
    if(!batch?.articles?.length){articles.append(el('p','暂未有完整输出的文章。生成并审核通过后，文件会显示在这里。','runtime-hint'));return;}
    for(const article of batch.articles){const row=el('div',undefined,'runtime-article'),name=el('div');name.append(el('strong',article.title),el('p',article.filename||'Markdown 文章','runtime-hint'));const button=el('button','下载 MD');button.type='button';button.addEventListener('click',()=>download(article).catch(onError));row.append(name,button);articles.append(row);}
  }
  function reset(){setOwner(false);workspaceEmpty=true;setBatch(null);byId('overview-list').replaceChildren();for(const id of ['overview-total','overview-active','overview-articles'])byId(id).textContent='—';renderArticles(null);personal.select('models');management.select('members');detailTab('materials');changeView('overview');}
  setOwner(false);setBatch(null);changeView('overview');
  return {setOwner,setBatch,setWorkspaceEmpty,detailTab,renderOverview,renderArticles,reset};
}
