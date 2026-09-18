// 视觉验证：① 使用模型栏不含「跟随默认模型」；② 侧边栏折叠箭头足够醒目（≥20px 方块）。
// Run only with serve_ui_visual.py. No paid APIs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.GEO_TEST_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set GEO_TEST_PLAYWRIGHT_MODULE to the installed Playwright entry file.');
const { chromium } = await import(pathToFileURL(modulePath).href);
const account = process.argv[2];
if (!account) throw new Error('usage: node browser_visual_check.mjs <account>');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const output = path.resolve('output/playwright/visual-check');
await fs.mkdir(output, { recursive: true });
const failures = [];
try {
  await page.goto('http://127.0.0.1:8769/');
  await page.locator('#login-page').waitFor({ state: 'visible' });
  await page.getByRole('textbox', { name: '账号', exact: true }).fill(account);
  await page.locator('#login-password').fill('test-password');
  await page.getByRole('button', { name: '登录工作台' }).click();
  await page.locator('.geo-shell').waitFor({ state: 'visible' });

  // ① 侧边栏分组与箭头
  const toggle = page.locator('.geo-nav-group__toggle').first();
  await toggle.waitFor({ state: 'visible' });
  const chevron = page.locator('.geo-nav-group__chevron').first();
  const box = await chevron.evaluate(el => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
  console.log('chevron size:', JSON.stringify(box));
  if (!(box.w >= 20 && box.h >= 20)) failures.push(`箭头过小：${box.w}x${box.h}`);
  // 折叠展开可用
  await toggle.click();
  const collapsed = await page.locator('.geo-nav-group').first().evaluate(el => el.classList.contains('is-collapsed'));
  if (!collapsed) failures.push('点击后未折叠');
  await toggle.click();
  const expanded = await page.locator('.geo-nav-group').first().evaluate(el => !el.classList.contains('is-collapsed'));
  if (!expanded) failures.push('再次点击未展开');
  await page.screenshot({ path: path.join(output, 'sidebar-groups.png') });

  // ② 问句查询页：模型栏文案
  await page.locator('[data-view="questions"]').click();
  await page.locator('[data-question-model]').waitFor({ state: 'visible' });
  const modelText = (await page.locator('[data-question-model]').textContent()) || '';
  console.log('question model text:', modelText);
  if (modelText.includes('跟随默认模型')) failures.push('仍显示「跟随默认模型」');
  if (!modelText.trim()) failures.push('模型栏为空');
  await page.screenshot({ path: path.join(output, 'question-page.png') });
} catch (error) {
  failures.push('异常: ' + error.message);
} finally {
  await browser.close();
}
console.log('VISUAL_CHECK_REPORT:' + JSON.stringify({ failures, ok: !failures.length, pageErrors: errors }));
process.exit(!failures.length && !errors.length ? 0 : 1);
