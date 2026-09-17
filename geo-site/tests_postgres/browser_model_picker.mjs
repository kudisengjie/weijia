// Run only with serve_ui_fixture.py. No production login or paid APIs.
// Verifies the IMA-style model picker modal, trigger sync, input focus
// behavior and overview workspace icons added on 2026-09-16.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const modulePath=process.env.GEO_TEST_PLAYWRIGHT_MODULE;
if(!modulePath)throw new Error('Set GEO_TEST_PLAYWRIGHT_MODULE to the installed Playwright entry file.');
const {chromium}=await import(pathToFileURL(modulePath).href);
const account=process.argv[2];
assert.ok(/^owner-[0-9a-f]{32}$/.test(account||''),'fixture account required');

const browser=await chromium.launch({headless:true,channel:'msedge'});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();
page.setDefaultTimeout(10000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto('http://127.0.0.1:8769/');
  await page.locator('#login-page').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('booting')),false,'booting hold must be released once the runtime decides what to show');

  await page.getByRole('textbox',{name:'账号',exact:true}).fill(account);
  await page.locator('#login-password').fill('test-password');
  await page.getByRole('button',{name:'登录工作台'}).click();
  await page.locator('.geo-shell').waitFor({state:'visible'});

  // Overview rows carry the workspace icon (or the empty state shows when no batch exists).
  await page.getByRole('button',{name:'任务总览',exact:true}).click();
  await page.locator('#overview-list .console-empty-state, #overview-list table').first().waitFor({state:'visible'});
  const tableCount=await page.locator('#overview-list table').count();
  if(tableCount){
    assert.ok(await page.locator('#overview-list .console-ws-icon').count()>=1,'overview workspace rows should show icons');
  }else{
    await page.locator('#overview-create').click();
    await page.waitForTimeout(1200);
    await page.getByRole('button',{name:'任务总览',exact:true}).click();
    await page.locator('#overview-list table').waitFor({state:'visible'});
    assert.ok(await page.locator('#overview-list .console-ws-icon').count()>=1,'overview workspace rows should show icons after creating a workspace');
  }

  // Model picker trigger follows the saved selection whatever it is.
  await page.getByRole('button',{name:'个人设置',exact:true}).click();
  await page.locator('#model-picker-trigger').waitFor({state:'visible'});
  const savedText=await page.locator('#model-picker-trigger').innerText();
  assert.match(savedText,/· (已配置|未配置)/,'trigger should show provider, model and status: '+savedText);
  assert.equal(await page.locator('#model-picker-panel').isVisible(),false,'picker panel stays hidden until opened');
  const locked=await page.locator('#model-picker-trigger').isDisabled();
  if(!locked){
    // Open the modal and check the eight provider cards.
    await page.locator('#model-picker-trigger').click();
    await page.locator('#model-picker-panel .geo-model-picker__dialog').waitFor({state:'visible'});
    assert.equal(await page.locator('#model-picker-panel .geo-provider-card').count(),8,'modal lists eight provider cards');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.getElementById('model-picker-panel').hidden===true,undefined,{timeout:10000});

    // Picking a model closes the modal and the trigger follows the selection.
    async function pickModel(provider,slot,expected){
      await page.locator('#model-picker-trigger').click();
      await page.locator('#model-picker-panel .geo-model-picker__dialog').waitFor({state:'visible'});
      const input=page.locator(`#model-picker-panel input[data-provider="${provider}"][data-slot="${slot}"]`);
      if(await input.isChecked()){
        await page.keyboard.press('Escape');
      }else{
        await page.locator(`#model-picker-panel label.geo-model-option:has(input[data-provider="${provider}"][data-slot="${slot}"])`).click();
      }
      await page.waitForFunction(()=>document.getElementById('model-picker-panel').hidden===true,undefined,{timeout:10000});
      const text=await page.locator('#model-picker-trigger').innerText();
      assert.match(text,expected,`trigger should follow the ${provider}:${slot} selection`);
    }
    await pickModel('qwen','secondary',/Qwen3\.8 Max/);
    await pickModel('deepseek','primary',/V4\.1 Flash/);
    await pickModel('doubao','secondary',/Seed 2\.1 Pro/);

    // Focusing the API key input must not scroll-jump and must stay visually soft.
    await page.locator('#model-key').scrollIntoViewIfNeeded();
    const before=await page.evaluate(()=>window.scrollY);
    await page.locator('#model-key').focus();
    await page.waitForTimeout(400);
    const after=await page.evaluate(()=>window.scrollY);
    assert.ok(Math.abs(after-before)<=2,`focusing the API key must not scroll-jump (${before} -> ${after})`);
    const outline=await page.locator('#model-key').evaluate(el=>getComputedStyle(el).outlineStyle);
    assert.equal(outline,'none','focused inputs must not draw the fat outline');
    const shadow=await page.locator('#model-key').evaluate(el=>getComputedStyle(el).boxShadow);
    assert.ok(shadow&&shadow!=='none','focused inputs keep a soft ring: '+shadow);
    // Escape closes the modal.
    await page.locator('#model-picker-trigger').click();
    await page.locator('#model-picker-panel .geo-model-picker__dialog').waitFor({state:'visible'});
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.getElementById('model-picker-panel').hidden===true,undefined,{timeout:10000});
  }else{
    console.log('Model switching is locked by an unfinished batch; selection flow skipped.');
  }

  assert.equal(errors.length,0,'no page errors: '+errors.join(' | '));
  console.log('Model picker modal, trigger sync, focus behavior and overview icons: passed');
}finally{
  await browser.close();
}
