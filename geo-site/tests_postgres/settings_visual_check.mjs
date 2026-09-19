// 设置页补充截图：联系与续费（二维码+形象）、积分与有效期（流水表）
import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.GEO_TEST_PLAYWRIGHT_MODULE;
const { chromium } = await import(pathToFileURL(modulePath).href);
const account = process.argv[2];
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.setDefaultTimeout(15000);
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
  await page.locator('[data-view="settings"]').click();
  const tab = page.locator('[data-settings-tab]');
  await tab.filter({ hasText: '积分与有效期' }).click();
  await page.waitForFunction(() => (document.querySelector('#own-ledger')?.textContent || '').includes('当前余额'), undefined, { timeout: 15000 });
  const pane = page.locator('[data-settings-pane="billing"]');
  if (!(await pane.locator('.ledger-summary').isVisible())) failures.push('余额摘要不可见');
  const hasTable = await pane.locator('.runtime-ledger table').isVisible();
  const ledgerText = await pane.locator('#own-ledger').textContent();
  if (!hasTable && !String(ledgerText).includes('暂无积分流水')) failures.push('积分流水既无表格也无空态提示');
  await page.screenshot({ path: path.join(output, 'settings-billing.png') });
  await tab.filter({ hasText: '联系与续费' }).click();
  const qr = page.locator('.wechat-qr');
  await qr.waitFor({ state: 'visible' });
  const w = await qr.evaluate(el => el.getBoundingClientRect().width);
  if (w < 160) failures.push(`二维码过小：${w}px`);
  const mascotVisible = await page.locator('.contact-mascot').isVisible();
  if (!mascotVisible) failures.push('合掌感谢形象不可见');
  await page.screenshot({ path: path.join(output, 'settings-contact.png') });
  // 文章保存页：验证恢复文案接线（未选过文件夹时应显示"尚未选择"而非报错）
  await tab.filter({ hasText: '文章保存' }).click();
  const savingText = await page.locator('#saving-status').textContent();
  console.log('saving status:', savingText);
  if (!savingText.includes('文件夹')) failures.push(`文章保存状态异常：${savingText}`);
} catch (error) {
  failures.push('异常: ' + error.message);
} finally {
  await browser.close();
}
console.log('SETTINGS_CHECK_REPORT:' + JSON.stringify({ failures, ok: !failures.length }));
process.exit(!failures.length ? 0 : 1);
