import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// Local acceptance only: provide a real local login password through stdin.
// Generation transport is intercepted; this never spends model quota.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const local=JSON.parse(await fs.readFile(path.join(root,'.local/edgeone-secrets.json'),'utf8'));
let password='';for await(const chunk of process.stdin)password+=chunk.toString();password=password.trim();
const {chromium}=await import(pathToFileURL(process.env.GEO_PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const output=path.join(root,'.local/browser-check');await fs.mkdir(output,{recursive:true});
const batch={id:'a'.repeat(32),model:{id:'kimi',label:'Kimi K3'},phase:'done',phaseLabel:'全部完成',seq:1,status:'completed',completed:1,total:1,requests:2,title:'验收品牌',articles:[{index:1,brand:'验收品牌',title:'验收问题',markdown:'# 测试文章\n\n仅用于界面验收。'}]};
try {
  await page.goto('http://127.0.0.1:8787',{waitUntil:'networkidle'});
  await assert.equal(await page.locator('.geo-shell').isVisible(),false);
  await page.screenshot({path:path.join(output,'login-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile login must not overflow');
  const mascot=await page.locator('.login-art > img').boundingBox();assert.ok(mascot.width<=170);
  await page.screenshot({path:path.join(output,'login-mobile.png'),fullPage:true});
  await page.getByLabel('账号',{exact:true}).fill(local.GEO_ACCOUNT);
  await page.locator('#login-password').fill(password);password='';
  await page.locator('.login-submit').click();await page.locator('.geo-shell').waitFor({state:'visible'});
  await page.locator('[data-view="settings"]').click();
  await page.locator('input[value="kimi:secondary"]').check();
  await page.locator('#model-key').fill('browser-acceptance-key-not-real');
  await page.getByRole('button',{name:'保存模型与密钥',exact:true}).click();
  await page.locator('#model-message').filter({hasText:'已保存。'}).waitFor();
  assert.equal(await page.locator('#model-key').inputValue(),'');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile settings must not overflow');
  await page.screenshot({path:path.join(output,'settings-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  const row=page.locator('input[value="kimi:secondary"]').locator('..');
  const dot=await row.locator('i').boundingBox(),label=await row.locator('strong').boundingBox();assert.ok(Math.abs(dot.y+dot.height/2-label.y-label.height/2)<3,'radio dot and model label are horizontally aligned');
  await page.screenshot({path:path.join(output,'settings-desktop.png'),fullPage:true});
  let submitted;
  await page.route('**/api/batches',async route=>{
    if(route.request().method()==='POST'){
      const attempt=route.request().postDataJSON();
      if(process.argv.includes('--recovery')&&!submitted){submitted=attempt;await route.fulfill({status:503,json:{error:'模拟提交结果不确定',code:'SERVER_ERROR'}});return;}
      if(process.argv.includes('--recovery'))assert.equal(attempt.requestId,submitted.requestId,'uncertain submission must reuse the original request ID');
      submitted=attempt;await route.fulfill({json:batch});
    }
    else await route.fulfill({json:{batches:[batch]}});
  });
  await page.route('**/api/batches/'+batch.id,route=>route.fulfill({json:batch}));
  await page.locator('[data-view="workspace"]').click();
  const csv='品牌名,GEO知识库,问句\n验收品牌,品牌库,验收问题';
  await page.locator('#task-file').setInputFiles({name:'验收任务.csv',mimeType:'text/csv',buffer:Buffer.from('\ufeff'+csv)});
  const completeText='完整公司资料。'.repeat(2000)+'TAIL_MUST_BE_SUBMITTED';
  await page.locator('#company-files').setInputFiles({name:'验收公司.md',mimeType:'text/markdown',buffer:Buffer.from(completeText)});
  await page.locator('#company-preview input').fill('验收品牌');
  await page.locator('#run-task').click();
  if(process.argv.includes('--recovery')){await page.locator('#runtime-toast').filter({hasText:'模拟提交结果不确定'}).waitFor();await page.locator('#run-task').click();}
  await page.locator('#batch-progress h2').filter({hasText:'全部完成'}).waitFor();
  assert.ok(submitted.companies[0].text.endsWith('TAIL_MUST_BE_SUBMITTED'),'submit full document, not truncated preview');
  const downloadPromise=page.waitForEvent('download');await page.locator('#batch-progress').getByRole('button',{name:'下载 MD'}).click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/\.md$/);
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: desktop/mobile login, real local authentication, model key save, aligned options, full-text submission and MD download (generation transport mocked).');
  console.log('Screenshots: .local/browser-check/');
} finally {await context.close();await browser.close();}
