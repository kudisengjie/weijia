// Run only with serve_ui_fixture.py. No production login or paid APIs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath=process.env.GEO_TEST_PLAYWRIGHT_MODULE;
if(!modulePath)throw new Error('Set GEO_TEST_PLAYWRIGHT_MODULE to the installed Playwright entry file.');
const {chromium}=await import(pathToFileURL(modulePath).href);
const owner=process.argv[2];
const resume=process.argv.includes('--resume');
if(!/^owner-[0-9a-f]{32}$/.test(owner||''))throw new Error('Only an isolated fixture owner is allowed');
const browser=await chromium.launch({headless:true,channel:'msedge'});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const page=await context.newPage();
page.setDefaultTimeout(10000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
page.on('dialog',dialog=>dialog.accept());
const output=path.resolve('output/playwright/saas-runtime');await fs.mkdir(output,{recursive:true});
async function textContains(selector, text){await page.waitForFunction(({selector,text})=>document.querySelector(selector)?.textContent.includes(text),{selector,text},{timeout:10000});}
async function login(account){await page.goto('http://127.0.0.1:8769/');await page.locator('#login-page').waitFor({state:'visible'});await page.getByRole('textbox',{name:'账号',exact:true}).fill(account);await page.locator('#login-password').fill('test-password');await page.getByRole('button',{name:'登录工作台'}).click();await page.locator('.geo-shell').waitFor({state:'visible'});await page.getByRole('button',{name:'个人设置',exact:true}).click();await page.locator('[data-settings-tab=billing]').click();await page.locator('#account-service').waitFor({state:'visible'});}
try{
  await login(owner);
  await page.locator('[data-view=admin]').click();
  await page.locator('[data-admin-tab=credits]').click();
  if(process.argv.includes('--layout-only')){
    await page.locator('#tenant-admin').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('#managed-user').evaluate(el=>el.getBoundingClientRect().height)>=38);
    await page.locator('[data-admin-tab=subscription]').click();
    assert.ok(await page.locator('#subscription-form [name=expiresAt]').evaluate(el=>el.getBoundingClientRect().width)>=240);
    await page.screenshot({path:path.join(output,'owner-admin-desktop.png')});
    console.log('Updated select sizing and unclipped date layout: passed');
    await browser.close();process.exit(0);
  }
  console.log((await page.locator('#tenant-admin').ariaSnapshot()).slice(0,1600));
  await page.locator('#managed-user').selectOption({label:'qa-member'});
  if(!resume){
  await textContains('#managed-user-summary','0 积分');
  await page.locator('#credit-form [name=amount]').fill('5');
  await page.getByRole('button',{name:'确认调整该账号积分'}).click();
  await textContains('#credit-message','余额为 5 积分');
  await textContains('#member-ledger','管理员发放');
  await page.locator('[data-admin-tab=subscription]').click();
  await page.getByRole('button',{name:'在有效期基础上增加 30 天'}).click();
  await page.getByRole('button',{name:'保存有效期',exact:true}).click();
  await textContains('#subscription-message','有效期已保存');
  }
  await page.locator('[data-admin-tab=members]').click();
  await page.locator('#member-form [name=username]').fill('qa-created');
  await page.locator('#member-form [name=password]').fill('test-password');
  console.log('Member form validity:',await page.locator('#member-form').evaluate(form=>form.checkValidity()));
  await page.getByRole('button',{name:'创建子账号',exact:true}).click();
  await textContains('#member-message','子账号已创建');
  assert.equal(await page.locator('#member-form [name=password]').inputValue(),'');
  await textContains('#managed-user-summary','qa-created');
  await page.locator('#tenant-admin').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'owner-admin-desktop.png')});
  console.log(resume?'Owner create: passed (grant / renewal already verified, not repeated)':'Owner create / selected-member grant / renewal / ledger: passed');

  await page.getByRole('button',{name:'历史批次',exact:true}).click();
  await page.getByRole('button',{name:'打开批次',exact:true}).first().click();
  await page.getByRole('button',{name:'继续运行',exact:true}).click();
  await page.getByRole('button',{name:'暂停后续步骤',exact:true}).click();
  await textContains('#batch-progress','已暂停');
  await page.waitForFunction(()=>!document.querySelector('#batch-progress button')?.disabled);
  await page.getByRole('button',{name:'继续运行',exact:true}).click();
  await textContains('#batch-progress','全部完成');
  await page.locator('[data-detail-tab=articles]').click();
  await page.getByRole('button',{name:'下载 MD',exact:true}).first().waitFor({state:'visible'});
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载 MD',exact:true}).first().click();
  const artifact=await download;await artifact.saveAs(path.join(output,'article.md'));
  assert.match(await fs.readFile(path.join(output,'article.md'),'utf8'),/本机固定测试响应/);
  await page.getByRole('button',{name:'个人设置',exact:true}).click();
  await page.locator('[data-settings-tab=models]').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('input[name="model-option"]')].every(input=>!input.disabled));
  console.log('Real browser pause / resume / artifact download / model unlock: passed');

  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await login('qa-member');
  assert.equal(await page.locator('#tenant-admin').isVisible(),false);
  assert.equal(await page.locator('.ima-admin').isVisible(),false);
  assert.equal(await page.locator('[data-view=admin]').isVisible(),false);
  const forbidden=await page.evaluate(async()=>{const r=await fetch('/api/tenant/members');return r.status;});
  assert.equal(forbidden,403,'real backend must reject member access to owner records');
  await page.getByRole('button',{name:'查看我的积分流水',exact:true}).click();
  await textContains('#own-ledger','管理员发放');
  assert.match(await page.locator('[data-credit-balance]').first().textContent(),/5/);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#account-service').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:path.join(output,'member-mobile.png')});
  await page.locator('[data-settings-tab=contact]').click();
  assert.equal(await page.locator('.wechat-contact').isVisible(),true);
  console.log('Member privilege isolation / contact QR / own ledger / mobile width: passed');
  assert.deepEqual(errors,[]);
  console.log('No browser JavaScript errors.');
}catch(error){
  console.log(JSON.stringify({browserErrors:errors,details:await page.evaluate(()=>({
    memberMessage:document.querySelector('#member-message')?.textContent,
    invalidFields:[...document.querySelectorAll('#member-form input:invalid')].map(input=>({name:input.name,message:input.validationMessage})),
    toast:document.querySelector('#runtime-toast')?.textContent
  }))}));
  await page.screenshot({path:path.join(output,'failure.png')});throw error;
}finally{await browser.close();}
