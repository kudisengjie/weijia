// Local design review only. Never connects to production or a model API.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../../..');
const entry = process.env.GEO_TEST_PLAYWRIGHT_MODULE;
assert.ok(entry, 'Set GEO_TEST_PLAYWRIGHT_MODULE to the installed Playwright entry.');
const { chromium } = await import(pathToFileURL(entry).href);
const output = path.join(root, 'geo-site/output/playwright/console-concepts');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('file:') ? route.continue() : route.abort());
  const url = pathToFileURL(path.join(directory, 'index.html')).href;
  const modes = process.argv.includes('--remaining') ? ['login'] : process.argv.includes('--visual-fix') ? ['a', 'login'] : ['a', 'b', 'settings', 'owner', 'login'];
  for (const mode of modes) {
    await page.setViewportSize({ width: 1440, height: mode === 'a' ? 1000 : 900 });
    await page.goto(url + '#' + mode);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('img').evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, mode);
    assert.equal(await page.locator('img').evaluateAll(imgs => imgs.every(img => img.complete && img.naturalWidth > 0)), true, 'Images must load: ' + mode);
    await page.screenshot({ path: path.join(output, `${mode}-desktop.png`), fullPage: true });
    console.log('Draft rendered: ' + mode);
  }
  await page.goto(url + '#member');
  assert.equal(await page.locator('.owner-only').first().isVisible(), false);
  await page.goto(url + '#owner');
  assert.equal(await page.locator('#main h1').textContent(), '个人设置');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url + '#a');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile overflow');
  await page.screenshot({ path: path.join(output, 'a-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Local prototype: navigation, member-view hiding, images and mobile width passed. Not an API/security test.');
} finally {
  await browser.close();
}
