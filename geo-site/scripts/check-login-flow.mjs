// Real rendered application with controlled auth/network responses, not production credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {getModelPresentation,MODEL_PROVIDER_IDS} from '../src/model-switch.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=await import(pathToFileURL(process.env.GEO_TEST_PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,channel:'msedge'});
const errors=[];
let sessionCalls=0,loginCalls=0,invalid=false,holdSettings=false,heldSettings,allowWorkspace=false;
const model=getModelPresentation('deepseek','primary');
const session=()=>({authenticated:true,csrf:'browser-fixture',expiresAt:Date.now()+600000});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='geo-auth-check.test')return route.abort();
    if(url.pathname.startsWith('/api/')){
      if(url.pathname==='/api/auth/session'){sessionCalls++;return route.fulfill({json:session()});}
      if(url.pathname==='/api/auth/login'){loginCalls++;return route.fulfill({json:invalid?{authenticated:false}:session()});}
      if(url.pathname==='/api/auth/logout')return route.fulfill({json:{loggedOut:true}});
      if(url.pathname==='/api/settings'&&holdSettings){heldSettings=route;return;}
      if(allowWorkspace){
        if(url.pathname==='/api/settings')return route.fulfill({json:{model,providers:Object.fromEntries(MODEL_PROVIDER_IDS.map(id=>[id,{configured:true}])),ima:{configured:true},credits:{balance:10},subscription:{role:'member',active:true,expiresAt:Date.now()+86400000}}});
        if(url.pathname==='/api/batches')return route.fulfill({json:{batches:[]}});
        if(url.pathname==='/api/workspaces')return route.fulfill({json:route.request().method()==='GET'?{workspaces:[],occupied:0,limit:5}:{id:'fixture-workspace',status:'draft',version:0,batchId:null,batch:null,draft:{title:'新建任务',model,rows:[],companies:[]}}});
      }
      return route.fulfill({status:503,json:{error:'测试数据服务暂不可用'}});
    }
    const target=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!target.startsWith(root+path.sep))return route.abort();
    return route.fulfill({path:target});
  });
  await page.goto('https://geo-auth-check.test/');
  await page.waitForFunction(()=>document.querySelector('#login-message').textContent!=='正在检查登录状态…'||!document.querySelector('.geo-shell').hidden);
  assert.equal(await page.locator('.geo-shell').isVisible(),false,'old valid session must not skip the login form');
  assert.equal(sessionCalls,0,'fresh navigation should not even request session restoration');
  await page.locator('[name=account]').fill('fixture');
  await page.locator('#login-password').fill('fixture-password');
  invalid=true;
  await page.locator('.login-submit').click();
  await page.waitForFunction(()=>document.querySelector('#login-message').classList.contains('is-error'));
  assert.equal(await page.locator('.geo-shell').isVisible(),false);
  invalid=false;
  await page.locator('.login-submit').click();
  await page.locator('.geo-shell').waitFor({state:'visible'});
  assert.equal(await page.locator('#login-password').inputValue(),'');
  await page.reload();
  await page.locator('.geo-shell').waitFor({state:'visible'});
  assert.equal(sessionCalls,1,'same authenticated tab refresh restores via server');
  assert.equal(loginCalls,2,'no synthetic login submission on reload');
  page.on('dialog',dialog=>dialog.accept());
  await page.locator('#logout-button').click();
  await page.locator('#login-page').waitFor({state:'visible'});
  await page.reload();
  await page.locator('#login-page').waitFor({state:'visible'});
  assert.equal(sessionCalls,1,'logout removes the restoration marker');
  holdSettings=true;
  await page.locator('[name=account]').fill('fixture');await page.locator('#login-password').fill('fixture-password');
  await page.locator('.login-submit').click();await page.locator('.geo-shell').waitFor({state:'visible'});
  while(!heldSettings)await new Promise(resolve=>setTimeout(resolve,25));
  const oldRoute=heldSettings;holdSettings=false;
  await page.locator('#logout-button').click();await page.locator('#login-page').waitFor({state:'visible'});
  // The initial bootstrap must not leave the login button disabled after sign-out.
  await page.locator('[name=account]').fill('fixture');await page.locator('#login-password').fill('fixture-password');
  await page.locator('.login-submit').click();await page.locator('.geo-shell').waitFor({state:'visible'});
  await oldRoute.fulfill({status:401,json:{code:'LOGIN_REQUIRED',error:'expired old request'}});
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.geo-shell').isVisible(),true,'old 401 cannot erase a newer login');
  if(process.argv.includes('--brand')){
    assert.equal(await page.locator('.geo-brand__mark img').count(),1,'brand image must replace the snowflake glyph');
    await page.locator('.geo-brand__mark img').evaluate(async img=>{await img.decode();});
    const width=await page.locator('.geo-brand__mark').evaluate(n=>n.getBoundingClientRect().width);
    assert.ok(width>=32&&width<=46);
    await fs.mkdir(path.join(root,'output/playwright/console-implementation'),{recursive:true});
    await page.screenshot({path:path.join(root,'output/playwright/console-implementation/brand-desktop.png')});
  }
  allowWorkspace=true;await page.locator('[data-view=settings]').click();await page.locator('#new-workspace').click();await page.locator('#workspace-title').waitFor();
  await page.evaluate(()=>{
    const original=File.prototype.arrayBuffer;
    File.prototype.arrayBuffer=async function(){await new Promise(resolve=>{window.releaseFileRead=resolve;});return original.call(this);};
  });
  await page.locator('#task-file').setInputFiles({name:'delayed.csv',mimeType:'text/csv',buffer:Buffer.from('brand,question\nprivate,private question')});
  await page.waitForFunction(()=>Boolean(window.releaseFileRead));
  await page.locator('#logout-button').click();await page.locator('#login-page').waitFor({state:'visible'});
  await page.evaluate(()=>window.releaseFileRead());await page.waitForTimeout(100);
  assert.equal(await page.locator('#task-state').textContent(),'未选择','late private upload must not reappear after logout');
  assert.deepEqual(errors,[]);
  console.log('PASS: explicit entry, invalid response, manual login, refresh, logout, late 401 isolation'+(process.argv.includes('--brand')?', exact brand asset':'')+'; no JS errors.');
} catch(error){console.error('Auth browser errors:',errors);for(const page of browser.contexts().flatMap(c=>c.pages()))console.error('UI state:',await page.locator('#runtime-toast').textContent(),await page.locator('#workspace-save-state').textContent());throw error;} finally {await browser.close();}
