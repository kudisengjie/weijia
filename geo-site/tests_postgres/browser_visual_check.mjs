// 视觉验证：① 侧边栏两大分组默认折叠、箭头醒目、问句查询为 ⭐ 图标；② 问句页模型栏跟随默认模型；
// ③ 文档预览容器就位；④ 清除按键与进度条占位正常。Run only with serve_ui_visual.py. No paid APIs.
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
  // 默认折叠：两个分组初始都带 is-collapsed 且 aria-expanded=false
  const groups = page.locator('.geo-nav-group');
  const groupCount = await groups.count();
  if (groupCount !== 2) failures.push(`分组数量应为 2，实际 ${groupCount}`);
  for (let i = 0; i < groupCount; i += 1) {
    const group = groups.nth(i);
    const collapsedDefault = await group.evaluate(el => el.classList.contains('is-collapsed'));
    if (!collapsedDefault) failures.push(`分组 ${i + 1} 默认未折叠`);
    const ariaDefault = await group.locator('.geo-nav-group__toggle').getAttribute('aria-expanded');
    if (ariaDefault !== 'false') failures.push(`分组 ${i + 1} 默认 aria-expanded=${ariaDefault}`);
  }
  const chevron = page.locator('.geo-nav-group__chevron').first();
  const box = await chevron.evaluate(el => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
  console.log('chevron size:', JSON.stringify(box));
  if (!(box.w >= 20 && box.h >= 20)) failures.push(`箭头过小：${box.w}x${box.h}`);
  // 折叠展开可用
  await toggle.click();
  const collapsed = await page.locator('.geo-nav-group').first().evaluate(el => !el.classList.contains('is-collapsed'));
  if (!collapsed) failures.push('点击后未展开');
  await toggle.click();
  const expanded = await page.locator('.geo-nav-group').first().evaluate(el => el.classList.contains('is-collapsed'));
  if (!expanded) failures.push('再次点击未折叠');
  await page.screenshot({ path: path.join(output, 'sidebar-groups.png') });

  // ② 问句查询页：先展开问句板块（默认折叠），再检查 ⭐ 图标与模型栏
  const questionGroupToggle = page.locator('.geo-nav-group').first().locator('.geo-nav-group__toggle');
  await questionGroupToggle.click();
  await page.locator('[data-view="questions"]').click();
  await page.locator('[data-question-model]').waitFor({ state: 'visible' });
  const starCount = await page.locator('[data-view="questions"] svg path').evaluateAll(paths =>
    paths.filter(p => (p.getAttribute('d') || '').startsWith('M12 3.6l2.5 5.2')).length);
  if (starCount !== 1) failures.push(`问句查询 ⭐ 图标缺失（匹配 ${starCount}）`);
  const modelText = (await page.locator('[data-question-model]').textContent()) || '';
  console.log('question model text:', modelText);
  if (modelText.includes('跟随默认模型')) failures.push('仍显示「跟随默认模型」');
  if (!modelText.trim()) failures.push('模型栏为空');
  // 跟随默认模型：页面显示必须等于服务端已保存默认模型的 label（不写死具体厂商）
  const savedLabel = await page.evaluate(async () => {
    const r = await fetch('/api/settings', { credentials: 'same-origin', cache: 'no-store' });
    return (await r.json()).model.label;
  });
  console.log('saved default model label:', savedLabel);
  if (modelText.trim() !== savedLabel) failures.push(`模型栏未跟随默认模型（页面 ${modelText} vs 服务端 ${savedLabel}）`);
  // 连接验证面板的当前模型同样跟随默认（不再被活跃批次模型带偏）
  const verifyModel = (await page.locator('[data-verify-model]').textContent()) || '';
  if (!verifyModel.startsWith(savedLabel)) failures.push(`验证面板当前模型未跟随默认（${verifyModel}）`);
  // ③ 文档内容预览：真实选择一份 MD 文档，正文必须显示在预览区
  const preview = page.locator('#question-preview');
  await preview.waitFor({ state: 'attached' });
  if (!(await preview.isHidden())) failures.push('文档预览初始应为隐藏');
  if (!(await page.locator('#question-clear').isDisabled())) failures.push('未选文件时清除按钮应为禁用');
  const docPath = path.resolve('tests_postgres/output/visual-question-doc.md');
  await fs.mkdir(path.dirname(docPath), { recursive: true });
  await fs.writeFile(docPath, '小柠萌品牌介绍\n主营手打柠檬茶，门店位于广州金沙洲。\n目标客群：年轻白领与学生。\n产品：招牌香水柠檬茶、鸭屎香柠檬茶。\n');
  await page.locator('#question-files').setInputFiles([docPath]);
  await page.locator('#question-preview details').waitFor({ state: 'visible' });
  const previewText = (await page.locator('#question-preview details pre').textContent()) || '';
  if (!previewText.includes('香水柠檬茶')) failures.push('文档内容预览未显示正文');
  const rowText = (await page.locator('#question-file-list li').first().textContent()) || '';
  if (!rowText.includes('字符')) failures.push('文件行未显示字符数');
  if (await page.locator('#question-clear').isDisabled()) failures.push('选择文件后清除按钮应可用');
  await page.screenshot({ path: path.join(output, 'question-doc-preview.png') });
  // ④ 进度条占位（隐藏待用）
  const progress = page.locator('#question-progress');
  if (!(await progress.isHidden())) failures.push('进度条初始应为隐藏');
  // ⑤ 形象已回退原图 / 企微二维码 / 积分流水自动加载
  const cabinSrc = await page.locator('.geo-character img').getAttribute('src');
  if (!String(cabinSrc).includes('lxue-geo-founder')) failures.push(`状态舱形象应为原图：${cabinSrc}`);
  if (await page.locator('.heading-mascot').count()) failures.push('问句页比耶形象应已删除');
  const qrSrc = await page.locator('.wechat-qr').getAttribute('src');
  if (!String(qrSrc).includes('wechat-qr')) failures.push(`企微二维码缺失：${qrSrc}`);
  const qrWidth = await page.locator('.wechat-qr').evaluate(el => el.getBoundingClientRect().width).catch(() => 0);
  if (qrWidth > 0 && qrWidth < 160) failures.push(`二维码展示过小：${qrWidth}px`);
  const imaStatus = await page.locator('#ima-cache-status').textContent();
  console.log('ima cache status:', imaStatus);
  if (!imaStatus.includes('缓存状态')) failures.push(`IMA 缓存状态行异常：${imaStatus}`);
  await page.waitForFunction(() => (document.querySelector('#own-ledger')?.textContent || '').trim().length > 0, undefined, { timeout: 15000 })
    .catch(() => failures.push('积分流水未自动加载'));
  await page.screenshot({ path: path.join(output, 'question-page.png') });
} catch (error) {
  failures.push('异常: ' + error.message);
} finally {
  await browser.close();
}
console.log('VISUAL_CHECK_REPORT:' + JSON.stringify({ failures, ok: !failures.length, pageErrors: errors }));
process.exit(!failures.length && !errors.length ? 0 : 1);
