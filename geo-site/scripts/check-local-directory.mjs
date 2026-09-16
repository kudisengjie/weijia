// Local saving directory page regression: real Edge DOM, controlled API responses.
// GEO_TEST_PLAYWRIGHT_MODULE points to an already installed Playwright entry file.
// Covers phase B of docs/superpowers/plans/2026-09-16-glm-development-handoff.md §6/§12:
// 文章保存 page, gesture-driven picker invocation, account-scoped isolation and
// the honest unsupported state. The OS directory picker cannot be automated inside
// a browser, so this fixture stubs window.showDirectoryPicker for INTERACTION only;
// real on-disk write/close/read-back verification lives in src/local-output.test.mjs
// (Node + real temp directory, never OPFS/Blob).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getModelPresentation } from '../src/model-switch.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = process.env.GEO_TEST_PLAYWRIGHT_MODULE;
assert.ok(modulePath, 'Set GEO_TEST_PLAYWRIGHT_MODULE to an installed Playwright entry file.');
const { chromium } = await import(pathToFileURL(modulePath).href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const model = getModelPresentation('deepseek', 'primary');
const output = path.join(root, 'output/playwright/local-directory');
await fs.mkdir(output, { recursive: true });

const SCOPE_A = 'a'.repeat(32);
const SCOPE_B = 'b'.repeat(32);

const settings = {
  model,
  providers: Object.fromEntries(['hunyuan', 'qwen', 'doubao', 'deepseek', 'minimax', 'zhipu', 'kimi', 'mimo'].map(id => [id, { configured: true }])),
  ima: { configured: true, expiresAt: '2027-01-01' },
  credits: { balance: 800 },
  subscription: { role: 'owner', active: true, expiresAt: Date.now() + 30 * 86400000 },
  modelLocked: false,
};

async function openSession() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(`
    window.__pickerCalls = 0;
    window.showDirectoryPicker = async (options) => {
      window.__pickerCalls += 1;
      if (!options || options.mode !== 'readwrite') throw new Error('picker must request readwrite mode');
      const files = new Map(), dirs = new Map([['nested', new Map()]]);
      const permission = { state: 'granted' };
      return {
        kind: 'directory', name: '吕布文章输出',
        queryPermission: async () => permission.state,
        requestPermission: async () => { permission.state = 'granted'; return permission.state; },
        getDirectoryHandle: async (name) => ({ kind: 'directory', name, getDirectoryHandle: async () => ({}) }),
        getFileHandle: async (name, { create = false } = {}) => {
          if (!files.has(name) && !create) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
          if (!files.has(name)) files.set(name, { data: null });
          return {
            kind: 'file', name,
            createWritable: async () => ({ write: async c => { files.get(name).pending = c; }, close: async () => { files.get(name).data = files.get(name).pending; } }),
            getFile: async () => ({ size: files.get(name).data?.byteLength ?? 0, arrayBuffer: async () => files.get(name).data?.slice().buffer ?? new ArrayBuffer(0) }),
          };
        },
      };
    };
  `);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), p = url.pathname;
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (p.startsWith('/api/')) {
      if (p === '/api/auth/login') {
        const body = route.request().postDataJSON() || {};
        const scope = body.account === 'member-b' ? SCOPE_B : SCOPE_A;
        return route.fulfill({ json: { authenticated: true, csrf: 'fixture', expiresAt: Date.now() + 600000, accountScope: scope } });
      }
      if (p === '/api/auth/logout') return route.fulfill({ json: { loggedOut: true } });
      if (p === '/api/auth/session') return route.fulfill({ json: { authenticated: true, csrf: 'fixture', expiresAt: Date.now() + 600000, accountScope: SCOPE_A } });
      if (p === '/api/settings') return route.fulfill({ json: settings });
      if (p === '/api/batches') return route.fulfill({ json: { batches: [] } });
      if (p === '/api/workspaces') return route.fulfill({ json: { workspaces: [], occupied: 0, limit: 5 } });
      if (p === '/api/credits' || p.endsWith('/credits')) return route.fulfill({ json: { ledger: [] } });
      return route.fulfill({ status: 403, json: { error: 'not available in UI fixture' } });
    }
    const file = path.resolve(root, '.' + (p === '/' ? '/index.html' : p));
    if (!file.startsWith(root + path.sep)) return route.abort();
    return route.fulfill({ path: file });
  });
  await page.goto('http://127.0.0.1/');
  page.on('dialog', dialog => dialog.accept());
  await page.locator('[name=account]').fill('owner-a');
  await page.locator('#login-password').fill('fixture-password');
  await page.locator('.login-submit').click();
  await page.locator('.geo-shell').waitFor({ state: 'visible' });
  await page.locator('[data-view-panel=overview]').waitFor({ state: 'visible' });
  await page.locator('.geo-sidebar__nav button[data-view="settings"]').click();
  return { page, errors };
}

try {
  const { page, errors } = await openSession();
  try {
    // 1. 文章保存页签存在，登录后显示待选择状态（账号 A）。
    await page.locator('.console-directory__nav button[data-settings-tab="saving"]').click();
    await page.locator('#saving-settings').waitFor({ state: 'visible' });
    assert.match(await page.locator('#saving-status').textContent(), /尚未选择本机保存文件夹/);

    // 2. 选择动作只由按钮手势触发，并且以 readwrite 模式调用系统选择器。
    await page.locator('#saving-pick').click();
    await page.waitForFunction(() => document.getElementById('saving-status')?.textContent.includes('已授权'), null, { timeout: 3000 })
      .catch(() => { throw new Error('after picking, the pane must show the granted directory'); });
    assert.match(await page.locator('#saving-status').textContent(), /吕布文章输出/);
    assert.equal(await page.evaluate(() => window.__pickerCalls), 1, 'one gesture maps to one picker invocation');
    assert.ok(await page.locator('#saving-forget').isVisible(), 'a chosen directory must offer the forget action');

    // 3. 同一账号内重新打开页签即刷新状态，不重复弹选择器。
    await page.locator('.console-directory__nav button[data-settings-tab="models"]').click();
    await page.locator('.console-directory__nav button[data-settings-tab="saving"]').click();
    await page.waitForFunction(() => document.getElementById('saving-status')?.textContent.includes('吕布文章输出'));
    assert.equal(await page.evaluate(() => window.__pickerCalls), 1);

    // 4. 忘记此设备目录：只清设置，回到未选择状态。
    await page.locator('#saving-forget').click();
    await page.waitForFunction(() => document.getElementById('saving-status')?.textContent.includes('尚未选择'), null, { timeout: 3000 })
      .catch(() => { throw new Error('forgetting the directory must return to the unselected state'); });

    // 5. 换账号登录：本机目录按账号隔离，B 看不到 A 的选择。
    await page.locator('#logout-button').click();
    await page.locator('.login-submit').waitFor({ state: 'visible' });
    await page.locator('[name=account]').fill('member-b');
    await page.locator('#login-password').fill('fixture-password');
    await page.locator('.login-submit').click();
    await page.locator('.geo-shell').waitFor({ state: 'visible' });
    await page.locator('.geo-sidebar__nav button[data-view="settings"]').click();
    await page.locator('.console-directory__nav button[data-settings-tab="saving"]').click();
    await page.waitForFunction(() => document.getElementById('saving-status')?.textContent.includes('尚未选择'), null, { timeout: 3000 })
      .catch(() => { throw new Error('a different account scope must not inherit the previous directory'); });

    // 6. 响应式：桌面与手机无横向溢出。
    for (const [width, height, label] of [[1280, 900, 'desktop'], [390, 844, 'mobile']]) {
      await page.setViewportSize({ width, height });
      const dims = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      assert.ok(dims.page <= dims.client, `${label} must not scroll horizontally: ${JSON.stringify(dims)}`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(output, 'saving-page-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'saving-page-mobile.png') });

    assert.deepEqual(errors, [], `no JS errors expected: ${errors.join(' | ')}`);
    console.log('PASS local directory page: gesture picker, granted state, forget, account isolation, responsive.');
  } finally { await page.close(); }

  // Session 2: 不支持 showDirectoryPicker 的环境必须如实提示，而不是假装可用。
  const session2 = await openSession();
  const page2 = session2.page;
  try {
    await page2.evaluate(() => { delete window.showDirectoryPicker; });
    // 重新打开“文章保存”页签会触发状态刷新（directorychange -> renderSaving）。
    await page2.locator('.console-directory__nav button[data-settings-tab="models"]').click();
    await page2.locator('.console-directory__nav button[data-settings-tab="saving"]').click();
    await page2.waitForFunction(() => {
      const pane = document.getElementById('saving-settings');
      return pane && pane.textContent.includes('不支持自动保存到本地目录');
    }, null, { timeout: 3000 });
    assert.equal(await page2.locator('#saving-pick').count(), 0, 'unsupported browsers must not offer a picker button');
    assert.deepEqual(session2.errors, []);
    console.log('PASS unsupported browser: honest guidance without a picker button.');
  } finally { await page2.close(); }
} finally { await browser.close(); }
