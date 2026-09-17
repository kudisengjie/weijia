// 阶段 D-3 真实浏览器端到端：新模式批次 → awaiting_save → 写盘 → 回执 → 唤醒完成。
// 真实后端（serve_ui_fixture --local-delivery）+ 真实 dist 产物 + 内存 FSA stub。
// OS 目录选择器无法在浏览器内自动化，因此 showDirectoryPicker 按 FSA 真实契约打桩
// （建目录/写文件/读回逐字保留在 window.__saved 供断言）；磁盘级写读校验由
// src/article-delivery.test.mjs（Node 真实磁盘）覆盖。
// 覆盖场景：目录授权、ACK 丢失后 outbox 补确认、五工作区与第四/第五注入失败、
// 取消与迟到 ACK 竞争（服务器幂等，不重复扣费）。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.GEO_TEST_PLAYWRIGHT_MODULE).href);
const owner=process.argv[2];if(!/^owner-[0-9a-f]{32}$/.test(owner||''))throw new Error('Isolated account required');
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
page.on('console',message=>{if(message.type()==='warning'||message.type()==='error')console.log('[page]',message.type(),message.text());});
const output=path.resolve('output/playwright/local-delivery');await fs.mkdir(output,{recursive:true});

// —— 回执拦截：第 1 次丢弃（ACK 丢失）；armed 时延迟 3 秒制造取消竞争窗口 ——
let receiptCount=0,armDelay=false;
await page.route('**/api/artifacts/*/local-receipt',async route=>{
  receiptCount+=1;
  if(receiptCount===1)return route.abort('connectionfailed');
  if(armDelay){armDelay=false;await new Promise(resolve=>setTimeout(resolve,3000));}
  return route.fallback();
});

async function contains(selector,text){await page.waitForFunction(({selector,text})=>document.querySelector(selector)?.textContent.includes(text),{selector,text},{timeout:40000});}
async function select(id){await page.locator(`[data-workspace-id="${id}"]`).click();await page.locator(`[data-workspace-id="${id}"][aria-current=page]`).waitFor();await page.waitForFunction(()=>!document.querySelector('#reload-workspace').disabled);}
async function savingPane(){await page.locator('[data-view="settings"]').click();await page.locator('.console-directory__nav button[data-settings-tab="saving"]').click();await page.locator('#saving-settings').waitFor({state:'visible'});}
let seq=0;
async function newWorkspace(label){
  seq+=1;
  await page.locator('#new-workspace').click();
  await page.locator('#workspace-title').waitFor({state:'visible'});
  await page.locator('#workspace-title').fill(label);
  await page.locator('#task-file').setInputFiles({name:`任务${seq}.csv`,mimeType:'text/csv',buffer:Buffer.from(`\uFEFF品牌名,GEO知识库,问句\n零雪,品牌库,问题${seq}`)});
  await contains('#task-state','已读取');
  await page.locator('#company-files').setInputFiles({name:`公司${seq}.md`,mimeType:'text/markdown',buffer:Buffer.from('零雪内容服务，工作区资料。')});
  await contains('#company-state','1/1');await page.locator('#company-preview input').fill('零雪');
  await page.locator('#workspace-model').selectOption('qwen:primary');
  await page.locator('#save-workspace').click();await contains('#workspace-save-state','已保存');
  return await page.locator('[data-workspace-id][aria-current=page]').getAttribute('data-workspace-id');
}
async function savedFiles(){return await page.evaluate(()=>window.__saved.map(entry=>({path:entry.path,name:entry.name,text:entry.text})));}
async function pendingText(){await savingPane();await contains('#saving-pending-wrap','待补存文章');return await page.locator('#saving-pending-wrap').textContent();}
try{
  await page.addInitScript(`
    window.__saved=[];
    function makeDir(name,path){
      const files=new Map(),dirs=new Map();
      return {
        kind:'directory',name,
        async queryPermission(){return 'granted';},
        async requestPermission(){return 'granted';},
        async getDirectoryHandle(child,{create=false}={}){
          if(!dirs.has(child)){
            if(!create)throw Object.assign(new Error('NotFoundError'),{name:'NotFoundError'});
            dirs.set(child,makeDir(child,[...path,child]));
          }
          return dirs.get(child);
        },
        async getFileHandle(child,{create=false}={}){
          if(!files.has(child)){
            if(!create)throw Object.assign(new Error('NotFoundError'),{name:'NotFoundError'});
            files.set(child,{data:null});
          }
          const record=files.get(child);
          return {
            kind:'file',name:child,
            async createWritable(){return{
              async write(chunk){record.pending=chunk;},
              async close(){record.data=record.pending;window.__saved.push({path:[...path],name:child,text:new TextDecoder().decode(record.data)});},
            };},
            async getFile(){return{size:record.data?.byteLength??0,arrayBuffer:async()=>record.data?.slice().buffer??new ArrayBuffer(0)};},
          };
        },
      };
    }
    window.showDirectoryPicker=async options=>{
      if(!options||options.mode!=='readwrite')throw new Error('picker must request readwrite mode');
      window.__pickerCalls=(window.__pickerCalls||0)+1;
      return makeDir('吕布文章输出',[]);
    };
  `);
  await page.goto('http://127.0.0.1:8769/');
  await page.locator('#login-password').fill('test-password');
  await page.locator('[name=account]').fill(owner);
  await page.locator('.login-submit').click();
  await page.locator('.geo-shell').waitFor({state:'visible'});

  // 场景 A：手势授权本机目录（打桩 picker，readwrite 模式）。
  await savingPane();
  await page.locator('#saving-pick').click();
  await contains('#saving-status','已授权');
  assert.equal(await page.evaluate(()=>window.__pickerCalls||0),1);

  // 场景 B：ACK 丢失 → 批次停在“等待保存到本机”→ outbox 补确认后自动完成。
  const ws1=await newWorkspace('交付工作区1');
  await page.locator('#run-task').click();
  await contains('#batch-progress','等待保存到本机');
  // 自动交付异步进行：等写盘完成（回执已被丢弃一次）与待补存数量刷新。
  await page.waitForFunction(()=>window.__saved.length>=1,null,{timeout:20000});
  await savingPane();
  await contains('#saving-pending-wrap','待补存文章：1 篇');
  assert.deepEqual(await savedFiles().then(files=>files.map(f=>f.name)),['1-零雪.md'],'file must be on the stubbed disk before any confirmation');
  await page.locator('#saving-deliver').click();
  await select(ws1);await contains('#batch-progress','全部完成');
  await savingPane();
  await contains('#saving-pending-wrap','待补存文章：没有');
  const delivered=await savedFiles();
  assert.equal(delivered.length,1);
  assert.ok(delivered[0].text.includes('问题1'));
  assert.deepEqual(delivered[0].path[0],'零雪GEO');
  await page.screenshot({path:path.join(output,'ack-recovered.png')});

  // 场景 C：五工作区并行，第四/第五注入失败（退款），其余自动交付完成。
  const ids=[ws1];
  for(let i=2;i<=5;i++)ids.push(await newWorkspace('交付工作区'+i));
  for(const id of ids.slice(1)){await select(id);await page.locator('#run-task').click();}
  for(const id of ids.slice(0,3)){await select(id);await contains('#batch-progress','全部完成');}
  for(const id of ids.slice(3)){await select(id);await contains('#batch-progress','未完成');await contains('#batch-progress','已返还 1');}
  await page.locator('[data-view=overview]').click();await page.locator('#refresh-overview').click();
  await contains('[data-credit-balance]','7');
  const files=await savedFiles();
  assert.equal(files.length,3,'exactly three articles land on the local disk');
  assert.ok(files.every(f=>f.text.includes('这是本机固定测试响应')));
  await page.screenshot({path:path.join(output,'five-delivery-desktop.png')});

  // 场景 D：取消与迟到 ACK 竞争——回执延迟 3 秒，窗口内取消批次；
  // 迟到回执必须幂等返回 already_refunded，绝不重复扣费。
  armDelay=true;
  const ws6=await newWorkspace('交付工作区6');
  await select(ws6);await page.locator('#run-task').click();
  await contains('#batch-progress','等待保存到本机');
  const competition=await page.evaluate(async()=>{
    const session=await (await fetch('/api/auth/session')).json();
    const headers={'Content-Type':'application/json','X-CSRF-Token':session.csrf};
    const pending=await (await fetch('/api/artifacts/pending')).json();
    const artifact=pending.items[0];
    const receipt=fetch(`/api/artifacts/${artifact.artifactId}/local-receipt`,{method:'POST',headers,
      body:JSON.stringify({requestId:crypto.randomUUID(),sha256:artifact.sha256,byteLength:artifact.byteLength})});
    const cancel=fetch(`/api/batches/${artifact.batchId}/cancel`,{method:'POST',headers,body:'{}'});
    const [receiptResponse,cancelResponse]=await Promise.all([receipt,cancel]);
    return {receiptStatus:receiptResponse.status,cancelStatus:cancelResponse.status,
      billing:(await receiptResponse.json()).receipt.billingStatus,batch:(await cancelResponse.json()).status};
  });
  assert.equal(competition.receiptStatus,200,competition.receiptStatus+' receipt must stay idempotent');
  // 结局一：取消先执行 → 退款 + 迟到回执 already_refunded（200）。
  // 结局二：回执先执行 → settled + 批次完成（seq 前移），取消因乐观锁 409 BATCH_CONFLICT 属正确语义。
  assert.ok(competition.cancelStatus===200||competition.cancelStatus===409,'cancel must be either applied or optimistically locked: '+competition.cancelStatus);
  assert.ok(['already_refunded','settled'].includes(competition.billing),'late receipt must never 409 or re-consume');
  await page.locator('[data-view=overview]').click();await page.locator('#refresh-overview').click();
  const expectedBalance=competition.billing==='settled'?'6':'7';
  // 服务器真相断账：UI 余额徽标由 refreshSettings 驱动，overview 刷新不触发它。
  const serverBalance=String(await page.evaluate(async()=>(await (await fetch('/api/settings')).json()).credits.balance));
  assert.equal(serverBalance,expectedBalance,'refund and late receipt must net to exactly one reversal');
  await savingPane();
  await contains('#saving-pending-wrap','待补存文章：没有','discarded artifact must leave the pending list');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(output,'delivery-mobile.png')});
  assert.deepEqual(errors,[],`no JS errors expected: ${errors.join(' | ')}`);
  console.log('Local delivery e2e: gesture grant, ack-loss outbox recovery, five workspaces with two injected failures, cancel vs late-receipt competition: passed');
}catch(error){
  console.error('Visible page text:',await page.locator('#batch-progress').textContent().catch(()=>'n/a'));
  console.error('Page errors:',errors);console.error('Saved files:',await page.evaluate(()=>window.__saved?.length).catch(()=>'n/a'));
  await page.screenshot({path:path.join(output,'failure.png')});throw error;
}finally{await browser.close();}
