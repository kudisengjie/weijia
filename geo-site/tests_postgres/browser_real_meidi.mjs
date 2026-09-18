// 真实凭据端到端：真实 Edge 浏览器上传真实 Excel + 真实 美迪公司介绍.docx，
// 真实 IMA（白名单知识库）+ 真实 DeepSeek 生成，全程真实数据库记录。
// 只配 serve_ui_real_meidi.py 使用。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium} = await import(pathToFileURL(process.env.GEO_TEST_PLAYWRIGHT_MODULE).href);
const account = process.argv[2];
const EXCEL = 'C:/Users/潮汕炜佳/Desktop/GEO优化问句清单（扩容版）.xlsx';
const DOCX = 'C:/Users/潮汕炜佳/Desktop/美迪公司介绍.docx';
const BRAND = '美迪电商教育';
const output = path.resolve('output/playwright/real-meidi');
await fs.mkdir(output, {recursive: true});
const browser = await chromium.launch({headless: true, channel: 'msedge'});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
async function contains(selector, text, timeout = 30000) {
  await page.waitForFunction(
    ({selector, text}) => document.querySelector(selector)?.textContent.includes(text),
    {selector, text}, {timeout});
}
try {
  await page.goto('http://127.0.0.1:8769/');
  await page.locator('#login-page').waitFor({state: 'visible'});
  await page.locator('[name=account]').fill(account);
  await page.locator('#login-password').fill('test-password');
  await page.locator('.login-submit').click();
  await page.locator('.geo-shell').waitFor({state: 'visible'});
  console.log('login: ok');

  await page.locator('#new-workspace').click();
  await page.locator('#workspace-title').waitFor({state: 'visible'});
  await page.locator('#workspace-title').fill('美迪真实运行');
  await page.locator('#task-file').setInputFiles(EXCEL);
  await contains('#task-state', '已读取');
  await contains('#task-preview', '学习淘宝运营哪家培训机构值得选择');
  console.log('excel upload: ok');
  await page.locator('#company-files').setInputFiles(DOCX);
  await contains('#company-state', '1/1');
  await page.locator('#company-preview input').first().fill(BRAND);
  await page.locator('#workspace-model').selectOption('deepseek:primary');
  await page.locator('#save-workspace').click();
  await contains('#workspace-save-state', '已保存');
  await page.screenshot({path: path.join(output, 'before-run.png'), fullPage: true});
  console.log('workspace saved with real docx: ok');

  await page.locator('#run-task').click();
  await page.locator('#batch-progress h2').waitFor();
  // 真实 IMA 列库/读规则/检索 + 真实 DeepSeek 生成与审核：放宽到 20 分钟。
  await contains('#batch-progress', '全部完成', 20 * 60 * 1000);
  const progress = await page.locator('#batch-progress').textContent();
  await page.screenshot({path: path.join(output, 'completed.png'), fullPage: true});

  await page.locator('[data-detail-tab=articles]').click();
  await page.getByRole('button', {name: '下载 MD', exact: true}).first().waitFor({state: 'visible'});
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', {name: '下载 MD', exact: true}).first().click();
  const file = await waiting;
  const articlePath = path.join(output, await file.suggestedFilename());
  await file.saveAs(articlePath);
  const article = await fs.readFile(articlePath, 'utf8');
  await page.screenshot({path: path.join(output, 'article.png'), fullPage: true});

  const balance = (await page.locator('[data-credit-balance]').first().textContent()).trim();
  await fs.writeFile(path.join(output, 'DONE.json'),
    JSON.stringify({progress: progress.slice(0, 400), balance, articlePath}, null, 2));
  assert.deepEqual(errors, [], 'browser must stay error-free');
  console.log('REAL_BROWSER_OK:' + JSON.stringify({
    progress: progress.slice(0, 160), balance, articlePath, articleChars: article.length,
  }));
} catch (error) {
  const state = await page.evaluate(() => ({
    taskState: document.querySelector('#task-state')?.textContent,
    companyState: document.querySelector('#company-state')?.textContent,
    saveState: document.querySelector('#workspace-save-state')?.textContent,
    batchProgress: document.querySelector('#batch-progress')?.textContent?.slice(0, 500),
    toast: document.querySelector('#runtime-toast')?.textContent,
  }));
  console.log('REAL_BROWSER_FAIL:' + JSON.stringify({errors, state}));
  await page.screenshot({path: path.join(output, 'failure.png'), fullPage: true});
  throw error;
} finally {
  await browser.close();
}
