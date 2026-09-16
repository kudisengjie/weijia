// Real formal bundle + HTTP routes + isolated PostgreSQL. Upstreams are fixture-only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.GEO_TEST_PLAYWRIGHT_MODULE).href);
const owner=process.argv[2];if(!/^owner-[0-9a-f]{32}$/.test(owner||''))throw new Error('Isolated account required');
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const output=path.resolve('output/playwright/five-workspaces');await fs.mkdir(output,{recursive:true});
async function contains(selector,text){await page.waitForFunction(({selector,text})=>document.querySelector(selector)?.textContent.includes(text),{selector,text},{timeout:35000});}
async function saved(){await contains('#workspace-save-state','已保存');}
async function value(selector,expected){await page.waitForFunction(({selector,expected})=>document.querySelector(selector)?.value===expected,{selector,expected});}
async function select(id){await page.locator(`[data-workspace-id="${id}"]`).click();await page.locator(`[data-workspace-id="${id}"][aria-current=page]`).waitFor();await page.waitForFunction(()=>!document.querySelector('#reload-workspace').disabled);}
async function login(account){await page.goto('http://127.0.0.1:8769/');await page.locator('#login-password').fill('test-password');await page.locator('[name=account]').fill(account);await page.locator('.login-submit').click();await page.locator('.geo-shell').waitFor({state:'visible'});}
try{
  await login(owner);
  await page.locator('#new-workspace').click();await page.locator('#workspace-title').waitFor({state:'visible'});
  const ids=[];
  for(let i=1;i<=5;i++){
    if(i>1)await page.locator('#new-workspace').click();
    await page.locator('#workspace-title').fill('工作区'+i);
    await page.locator('#task-file').setInputFiles({name:`任务${i}.csv`,mimeType:'text/csv',buffer:Buffer.from('\uFEFF品牌名,GEO知识库,问句\n零雪,品牌库,问题'+i)});
    await contains('#task-state','已读取');
    await page.locator('#company-files').setInputFiles({name:`公司${i}.md`,mimeType:'text/markdown',buffer:Buffer.from('零雪内容服务，工作区'+i+'独立资料。')});
    await contains('#company-state','1/1');await page.locator('#company-preview input').fill('零雪');
    await page.locator('#workspace-model').selectOption(i%2?'qwen:primary':'deepseek:primary');
    await page.locator('#save-workspace').click();await saved();
    ids.push(await page.locator('[data-workspace-id][aria-current=page]').getAttribute('data-workspace-id'));
  }
  assert.equal(new Set(ids).size,5);assert.equal(await page.locator('[data-workspace-id]').count(),5);assert.equal(await page.locator('#new-workspace').isDisabled(),true);
  await page.screenshot({path:path.join(output,'five-drafts-desktop.png')});
  await page.reload();await page.locator('.geo-shell').waitFor({state:'visible'});
  await select(ids[0]);
  await value('#workspace-title','工作区1');await contains('#company-preview','工作区1独立资料');await contains('#task-preview','问题1');
  assert.equal(await page.locator('#workspace-model').inputValue(),'qwen:primary');
  // A different page saves first. This page must keep local edits and reject an old version.
  await page.evaluate(async id=>{const session=await (await fetch('/api/auth/session')).json();const w=await(await fetch('/api/workspaces/'+id)).json();await fetch('/api/workspaces/'+id+'/save',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify({version:w.version,draft:{...w.draft,title:'另一页修改'}})});},ids[0]);
  await page.locator('#workspace-title').fill('本页待保护');await page.locator('#save-workspace').click();await contains('#workspace-save-state','另一页面');
  await page.locator(`[data-workspace-id="${ids[1]}"]`).click();assert.equal(await page.locator('#workspace-title').inputValue(),'本页待保护');
  await page.locator('#reload-workspace').click();await value('#workspace-title','另一页修改');
  await page.locator('#workspace-title').fill('工作区1');await page.locator('#save-workspace').click();await saved();
  console.log('Five persisted drafts, model/document isolation, reload and CAS conflict: passed');
  for(let i=0;i<5;i++){
    await select(ids[i]);await page.locator('#run-task').click();await page.locator('#batch-progress h2').waitFor();
    assert.equal(await page.locator('#workspace-model').isDisabled(),true);
  }
  await select(ids[0]);await page.getByRole('button',{name:'暂停后续步骤',exact:true}).click();
  await select(ids[1]);await contains('#batch-progress','全部完成');
  assert.equal(await page.locator('[data-view-panel=workspace] h1').textContent(),'工作区2','another loop must not steal selected workspace');
  await select(ids[0]);await contains('#batch-progress','已暂停');
  await page.getByRole('button',{name:'继续运行',exact:true}).click();await contains('#batch-progress','全部完成');
  for(let i=0;i<4;i++){
    await select(ids[i]);await contains('#batch-progress','全部完成');
    await page.locator('[data-detail-tab=articles]').click();const waiting=page.waitForEvent('download');await page.locator('#workspace-articles button').click();
    const file=await waiting;const content=await fs.readFile(await file.path(),'utf8');assert.ok(content.includes('问题'+(i+1)));assert.ok(!content.includes('问题5'));
  }
  await select(ids[4]);await contains('#batch-progress','未完成');await contains('#batch-progress','已返还 1');
  await page.locator('[data-view=overview]').click();await page.locator('#refresh-overview').click();await contains('[data-credit-balance]','6');
  await page.screenshot({path:path.join(output,'five-results-desktop.png')});
  await page.setViewportSize({width:390,height:844});await select(ids[0]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,'workspace-mobile.png')});
  assert.deepEqual(errors,[]);
  console.log('Independent browser execution, pause/resume, four actual MD downloads, one refund, responsive layout: passed');
}catch(error){console.error('Visible progress:',await page.locator('#batch-progress').textContent());console.error('Page errors:',errors);await page.screenshot({path:path.join(output,'failure.png')});throw error;}finally{await browser.close();}
