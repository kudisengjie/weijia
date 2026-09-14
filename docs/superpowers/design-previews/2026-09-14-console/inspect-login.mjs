// Reproduce existing FRONTEND session restoration with controlled responses.
// Not a test of production passwords, cookies or backend authorization.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../geo-site');
const { chromium } = await import(pathToFileURL(process.env.GEO_TEST_PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  for (const sessionValid of [false, true]) {
    const page = await browser.newPage();
    const paths = [];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'geo-auth-check.test') return route.abort();
      if (url.pathname.startsWith('/api/')) {
        paths.push(url.pathname);
        const session = url.pathname === '/api/auth/session';
        return route.fulfill({
          status: session ? sessionValid ? 200 : 401 : 503,
          json: session ? sessionValid ? { authenticated: true, csrf: 'fixture-only', expiresAt: Date.now() + 10000 }
            : { code: 'LOGIN_REQUIRED', error: '请先登录。' }
            : { error: 'Controlled settings unavailability for frontend diagnosis.' },
        });
      }
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: await fs.readFile(path.join(root, 'index.html'), 'utf8') });
      if (url.pathname === '/styles.css' || /^\/assets\/[\w./-]+$/.test(url.pathname)) {
        const target = path.resolve(root, '.' + url.pathname);
        if (!target.startsWith(root + path.sep)) return route.abort();
        return route.fulfill({ path: target });
      }
      return route.abort();
    });
    await page.goto('http://geo-auth-check.test/');
    await page.waitForFunction(() => document.querySelector('#login-message').textContent !== '正在检查登录状态…' || !document.querySelector('.geo-shell').hidden);
    assert.equal(await page.locator('.geo-shell').isVisible(), sessionValid);
    assert.equal(await page.locator('#login-password').inputValue(), '');
    assert.ok(!paths.includes('/api/auth/login'));
    console.log(JSON.stringify({ controlledSessionResponse: sessionValid ? 200 : 401, workspaceVisible: sessionValid, passwordEntered: false, loginSubmitted: false }));
    await page.close();
  }
} finally { await browser.close(); }
