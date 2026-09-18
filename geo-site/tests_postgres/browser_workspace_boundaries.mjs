import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.GEO_TEST_PLAYWRIGHT_MODULE).href);
const owner=process.argv[2];if(!/^owner-[0-9a-f]{32}$/.test(owner||''))throw new Error('Isolated owner required');
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:950}});page.setDefaultTimeout(12000);
page.on('dialog',d=>d.accept());const errors=[];page.on('pageerror',e=>errors.push(e.message));
async function until(fn,arg){try{await page.waitForFunction(fn,arg);}catch(error){console.log('UNTIL_TIMEOUT:',JSON.stringify(await page.evaluate(()=>({progress:document.querySelector('#batch-progress')?.textContent?.slice(0,220),toast:document.querySelector('#runtime-toast')?.textContent,balances:[...document.querySelectorAll('[data-credit-balance]')].map(n=>n.textContent)}))));throw error;}}
async function login(account){await page.goto('http://127.0.0.1:8769/');await page.locator('[name=account]').fill(account);await page.locator('#login-password').fill('test-password');await page.locator('.login-submit').click();await page.locator('.geo-shell').waitFor({state:'visible'});}
async function saved(){await until(()=>document.querySelector('#workspace-save-state').textContent.includes('已保存'));}
try{
  await login(owner);await page.locator('#new-workspace').click();await page.locator('#workspace-title').fill('原始草稿');await page.locator('#save-workspace').click();await saved();
  const first=await page.locator('[data-workspace-id][aria-current=page]').getAttribute('data-workspace-id');
  await page.locator('#new-workspace').click();await page.locator('#workspace-title').fill('另一个草稿');await page.locator('#save-workspace').click();await saved();
  const second=await page.locator('[data-workspace-id][aria-current=page]').getAttribute('data-workspace-id');
  await page.locator(`[data-workspace-id="${first}"]`).click();await until(()=>document.querySelector('#workspace-title').value==='原始草稿');
  let held,release,seen=[];const delivered=new Promise(r=>{release=r;});
  await page.route(`**/api/workspaces/${first}/save`,async route=>{seen.push(route.request().postDataJSON());const response=await route.fetch();if(seen.length===1){held=true;await delivered;}await route.fulfill({response});});
  await page.locator('#workspace-title').fill('正在保存第一版');await until(()=>document.querySelector('#workspace-save-state').textContent.includes('正在加密'));
  while(!held)await new Promise(r=>setTimeout(r,10));
  await page.locator('#workspace-title').fill('修改为第二版');await page.locator('#workspace-model').selectOption('qwen:secondary');
  // Switching while a save is held must flush the latest edit, not discard it.
  const switching=page.locator(`[data-workspace-id="${second}"]`).click();await switching;release();
  await until(()=>document.querySelector('#workspace-title').value==='另一个草稿');
  await page.locator(`[data-workspace-id="${first}"]`).click();await until(()=>document.querySelector('#workspace-title').value==='修改为第二版');
  assert.equal(await page.locator('#workspace-model').inputValue(),'qwen:secondary');assert.equal(seen.length,2,'queued save must not race the same version');
  assert.equal(seen[1].version,seen[0].version+1);
  const output=path.resolve('output/playwright/five-workspaces');await fs.mkdir(output,{recursive:true});
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:path.join(output,'workspace-toolbar-desktop.png')});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,'workspace-toolbar-mobile.png')});await page.setViewportSize({width:1440,height:950});
  console.log('Edits during an in-flight save survive switching; versions serialize: passed');
  await page.unroute(`**/api/workspaces/${first}/save`);
  await page.locator('#task-file').setInputFiles({name:'任务.csv',mimeType:'text/csv',buffer:Buffer.from('\uFEFF品牌名,GEO知识库,问句\n零雪,品牌库,问题1')});
  await until(()=>document.querySelector('#task-state').textContent==='已读取');
  await page.locator('#company-files').setInputFiles({name:'隐私.md',mimeType:'text/markdown',buffer:Buffer.from('仅属于总账号的私有资料')});await page.locator('#company-preview input').fill('零雪');await page.locator('#save-workspace').click();await saved();
  // Balance baseline BEFORE the batch: fixture fund 10 minus 1 reserved by the fixture's own prepared batch.
  const balanceBeforeRun=await page.locator('[data-credit-balance]').first().textContent();assert.match(balanceBeforeRun,/积分：\d+$/);
  await page.route(`**/api/workspaces/${first}/start`,async route=>{await route.fetch();await route.abort('failed');});
  await page.locator('#run-task').click();await until(()=>document.querySelector('#workspace-save-state').classList.contains('is-error'));
  assert.equal(await page.locator('#workspace-title').isDisabled(),true);assert.equal(await page.locator('#workspace-model').isDisabled(),true);
  await page.unroute(`**/api/workspaces/${first}/start`);await page.locator('#reload-workspace').click();await page.locator('#batch-progress h2').waitFor();
  assert.equal(await page.locator('#workspace-model').isDisabled(),true);
  await page.getByRole('button',{name:'取消批次并返还未完成积分',exact:true}).click();await until(()=>document.querySelector('#batch-progress').textContent.includes('已取消'));await until(expected=>document.querySelector('[data-credit-balance]').textContent===expected,balanceBeforeRun);
  await page.locator(`[data-workspace-id="${second}"]`).click();await until(()=>document.querySelector('#workspace-title').value==='另一个草稿');await page.locator('#close-workspace').click();await page.locator('[data-view-panel=overview]').waitFor({state:'visible'});
  await page.locator('#logout-button').click();await page.locator('#login-page').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-workspace-id]').count(),0);assert.equal(await page.locator('#company-preview').textContent(),'');
  await login('qa-member');await page.locator('#refresh-overview').click();assert.equal(await page.locator('[data-workspace-id]').count(),0);
  const response=await page.request.get('http://127.0.0.1:8769/api/workspaces/'+first);assert.equal(response.status(),404);
  assert.equal(await page.locator('[data-view=admin]').isVisible(),false);assert.deepEqual(errors,[]);
  console.log('Lost start response locks editing; reload/cancel refunds once; close draft and account isolation: passed');
}finally{await browser.close();}
