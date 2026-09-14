// Layout-only browser regression: real markup/styles, no login, database or model calls.
// GEO_TEST_PLAYWRIGHT_MODULE points to an already installed Playwright entry file.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = process.env.GEO_TEST_PLAYWRIGHT_MODULE;
assert.ok(modulePath, 'Set GEO_TEST_PLAYWRIGHT_MODULE to an installed Playwright entry file.');
const { chromium } = await import(pathToFileURL(modulePath).href);
const html = (await fs.readFile(path.join(root, 'index.html'), 'utf8'))
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const output = path.join(root, 'output/playwright/header-layout');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const errors = [];
try {
  const page = await browser.newPage();
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'geo-layout.test') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/styles.css') return route.fulfill({ path: path.join(root, 'styles.css') });
    if (/^\/assets\/[\w.-]+\.(png|webp|svg)$/.test(url.pathname)) {
      return route.fulfill({ path: path.join(root, url.pathname.slice(1)) });
    }
    return route.abort();
  });
  await page.goto('http://geo-layout.test/');
  await page.evaluate(() => {
    document.querySelector('#login-page').hidden = true;
    document.querySelector('.geo-shell').hidden = false;
    document.querySelector('[data-selected-model-status]').textContent = '已配置';
    document.querySelector('[data-ima-badge-status]').textContent = '已配置';
  });
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1280, 1440, 1920, 2560, 1024, 861, 860, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.locator('[data-view-panel="workspace"] .geo-heading').evaluate(heading => {
      const box = element => {
        const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
        return { x, y, width, height, right, bottom };
      };
      const subtitle = heading.querySelector('p');
      const range = document.createRange();
      range.selectNodeContents(subtitle);
      const subtitleText = box(range);
      const style = getComputedStyle(subtitle);
      return {
        heading: box(heading), title: box(heading.querySelector('h1')),
        badges: [...heading.querySelectorAll('.geo-model-badge')].map(box),
        subtitle: box(subtitle), subtitleText, subtitleSize: parseFloat(style.fontSize),
        lineHeight: parseFloat(style.lineHeight),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const check = (condition, message) => { if (!condition) errors.push(`${width}px: ${message}`); };
    const [model, ima] = metrics.badges;
    if (width > 860) {
      check(Math.abs(model.y - ima.y) < 1 && model.right <= ima.x, 'status cards must sit side by side');
      check(Math.max(model.height, ima.height) <= 60, 'status cards should be compact (height <= 60px)');
      check(ima.width <= 100, 'IMA card should not reserve excessive width');
      check(model.x >= metrics.title.right, 'cards must not overlap the title');
      check(ima.right <= metrics.heading.right + 1, 'cards must fit inside the heading');
      check(metrics.subtitle.height <= metrics.lineHeight + 1, 'subtitle must occupy one line');
      check(metrics.subtitleText.right <= metrics.heading.right + 1, 'full subtitle must fit without clipping');
      check(metrics.subtitleSize === 13, 'desktop subtitle should be 13px');
    } else {
      check(metrics.subtitleSize === 12, 'mobile subtitle typography must stay unchanged');
    }
    check(!metrics.overflow, 'page must not overflow horizontally');
    console.log(JSON.stringify({ width, ...metrics }));
    if ([1280, 1440, 390].includes(width)) {
      await page.screenshot({ path: path.join(output, `${width}.png`) });
    }
  }
  assert.deepEqual(errors, [], 'Header layout regressions');
  console.log('Header layout passed at 8 desktop/mobile widths; no upstream requests.');
} finally {
  await browser.close();
}
