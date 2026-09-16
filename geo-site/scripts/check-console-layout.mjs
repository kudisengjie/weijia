import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {getModelPresentation} from '../src/model-switch.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=await import(pathToFileURL(process.env.GEO_TEST_PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'msedge',headless:true});
const model=getModelPresentation('deepseek','primary');
const output=path.join(root,'output/playwright/console-implementation');
await fs.mkdir(output,{recursive:true});
const batches=[{id:'fixture-batch',title:'零雪品牌内容',model,status:'paused',phaseLabel:'文章审核',completed:1,total:3,seq:2,requests:2,createdAt:Date.now(),
  articles:[{title:'已保存测试文章',filename:'测试文章.md',artifactId:'fixture-artifact'}],billing:{complete:1,refunded:0,released:0,reserved:2},failedTasks:[]}];
try {
  for(const role of ['owner','member']){
    const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],ownerReads=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url()),p=url.pathname;
      if(url.hostname!=='console-check.test')return route.abort();
      if(p.startsWith('/api/')){
        if(p==='/api/auth/login')return route.fulfill({json:{authenticated:true,csrf:'fixture',expiresAt:Date.now()+600000}});
        if(p==='/api/settings')return route.fulfill({json:{model,providers:Object.fromEntries(['hunyuan','qwen','doubao','deepseek','minimax','zhipu','kimi','mimo'].map(id=>[id,{configured:true}])),ima:{configured:true,expiresAt:'2027-01-01'},credits:{balance:800},subscription:{role,active:true,expiresAt:Date.now()+30*86400000},modelLocked:true}});
        if(p==='/api/batches')return route.fulfill({json:{batches}});
        if(p==='/api/workspaces')return route.fulfill({json:{workspaces:[],occupied:1,limit:5}});
        if(p==='/api/batches/fixture-batch')return route.fulfill({json:batches[0]});
        if(p==='/api/artifacts/fixture-artifact')return route.fulfill({contentType:'text/markdown',body:'# 已保存测试文章\n这是固定浏览器测试数据。'});
        if(p.startsWith('/api/tenant/'))ownerReads.push(p);
        if(p==='/api/tenant/members')return route.fulfill({json:{members:[{id:'fixture-owner',username:'fixture-owner',role:'owner',balance:800,active:true,startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()}]}});
        if(p.endsWith('/credits')||p==='/api/credits')return route.fulfill({json:{ledger:[]}});
        return route.fulfill({status:403,json:{error:'not available in UI fixture'}});
      }
      const file=path.resolve(root,'.'+(p==='/'?'/index.html':p));
      if(!file.startsWith(root+path.sep))return route.abort();
      return route.fulfill({path:file});
    });
    await page.goto('http://console-check.test/');
    await page.locator('[name=account]').fill('fixture');await page.locator('#login-password').fill('fixture-password');await page.locator('.login-submit').click();
    await page.locator('.geo-shell').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-view-panel=overview]').isVisible(),true,'A is the default console');
    await page.locator('#overview-list button').first().waitFor();
    assert.equal(await page.locator('.geo-brand__mark img').count(),1);
    for(const width of [1440,1280,1920,390]){
      await page.setViewportSize({width,height:900});
      const dimensions=await page.evaluate(()=>({page:document.documentElement.scrollWidth,window:innerWidth,body:parseFloat(getComputedStyle(document.querySelector('.geo-shell')).fontSize),h1:parseFloat(getComputedStyle(document.querySelector('[data-view-panel=overview] h1')).fontSize)}));
      assert.ok(dimensions.page<=dimensions.window,JSON.stringify(dimensions));
      if(width>860){assert.equal(dimensions.body,12);assert.equal(dimensions.h1,22);}
      if(role==='owner'&&[1440,390].includes(width))await page.screenshot({path:path.join(output,`overview-${width}.png`)});
    }
    await page.setViewportSize({width:1440,height:900});
    await page.locator('#overview-list button').first().click();
    await page.locator('#batch-progress h2').waitFor();
    assert.equal(await page.locator('[data-view-panel=workspace]').isVisible(),true);
    await page.locator('[data-detail-tab=materials]').click();
    assert.equal(await page.locator('#run-task').isVisible(),false,'saved batch must not present a different draft as editable materials');
    assert.equal(await page.locator('#workspace-materials-summary').isVisible(),true);
    await page.locator('[data-detail-tab=articles]').click();
    const download=page.waitForEvent('download');await page.locator('#workspace-articles button').first().click();
    assert.equal((await download).suggestedFilename(),'测试文章.md');
    if(role==='owner')await page.screenshot({path:path.join(output,'detail-desktop.png')});
    await page.locator('[data-view=settings]').first().click();
    await page.locator('[data-settings-tab=security]').click();
    assert.equal(await page.locator('#security-settings').isVisible(),true);
    assert.equal(await page.locator('#model-form').isVisible(),false);
    await page.locator('[data-settings-tab=billing]').click();
    assert.equal(await page.locator('#account-service').isVisible(),true);
    await page.locator('[data-settings-tab=models]').click();
    assert.equal(await page.locator('#model-form').isVisible(),true);
    assert.equal(await page.locator('#member-form').isVisible(),false);
    if(role==='owner'){
      await page.screenshot({path:path.join(output,'settings-desktop.png')});
      await page.locator('[data-view=admin]').click();
      assert.equal(await page.locator('#member-form').isVisible(),true);
      await page.locator('[data-admin-tab=credits]').click();assert.equal(await page.locator('#credit-form').isVisible(),true);assert.equal(await page.locator('#member-form').isVisible(),false);
      await page.locator('[data-admin-tab=subscription]').click();assert.equal(await page.locator('#subscription-form').isVisible(),true);
      await page.locator('[data-admin-tab=ima]').click();assert.equal(await page.locator('#ima-form').isVisible(),true);
      await page.locator('[data-admin-tab=cache]').click();assert.equal(await page.locator('#clear-ima-cache').isVisible(),true);assert.equal(await page.locator('#ima-form').isVisible(),false);
      await page.locator('[data-admin-tab=members]').click();await page.screenshot({path:path.join(output,'admin-desktop.png')});
    }else{
      assert.equal(await page.locator('[data-view=admin]').isVisible(),false);
      await page.locator('[data-view=admin]').evaluate(n=>n.click());
      assert.equal(await page.locator('[data-view-panel=admin]').isVisible(),false);
      assert.equal(ownerReads.length,0,'members must not fetch owner records');
    }
    assert.deepEqual(errors,[]);console.log(`PASS console ${role}: real DOM navigation, responsive layout, settings isolation, artifact download; upstream fixture only.`);
    await page.close();
  }
} finally {await browser.close();}
