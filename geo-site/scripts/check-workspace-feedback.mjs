// Workspace creation feedback regression: real Edge DOM, controlled API responses.
// GEO_TEST_PLAYWRIGHT_MODULE points to an already installed Playwright entry file.
// Covers phase A of docs/superpowers/plans/2026-09-16-glm-development-handoff.md:
// empty-workspace guidance, immediate creation feedback, single idempotent create
// request, overview icon + mascot empty state, failure feedback and safe retry.
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
const output = path.join(root, 'output/playwright/workspace-feedback');
await fs.mkdir(output, { recursive: true });

const settings = {
  model,
  providers: Object.fromEntries(['hunyuan', 'qwen', 'doubao', 'deepseek', 'minimax', 'zhipu', 'kimi', 'mimo'].map(id => [id, { configured: true }])),
  ima: { configured: true, expiresAt: '2027-01-01' },
  credits: { balance: 800 },
  subscription: { role: 'owner', active: true, expiresAt: Date.now() + 30 * 86400000 },
  modelLocked: false,
};
const emptyWorkspaces = { workspaces: [], occupied: 0, limit: 5 };
const createdWorkspace = {
  id: 'a'.repeat(32), status: 'draft', version: 0, batchId: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  draft: { title: '新建任务', taskFileName: '', sheetName: '', rows: [], companies: [],
    model: { id: 'deepseek', slot: 'primary', modelId: 'deepseek-v4-flash', provider: 'DeepSeek', model: 'V4 Flash', label: 'DeepSeek V4 Flash' } },
};

async function openSession({ createHandler }) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let createRequests = 0;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), p = url.pathname;
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (p.startsWith('/api/')) {
      if (p === '/api/auth/login') return route.fulfill({ json: { authenticated: true, csrf: 'fixture', expiresAt: Date.now() + 600000 } });
      if (p === '/api/settings') return route.fulfill({ json: settings });
      if (p === '/api/batches') return route.fulfill({ json: { batches: [] } });
      if (p === '/api/workspaces') {
        if (route.request().method() === 'POST') { createRequests++; return createHandler(route); }
        return route.fulfill({ json: emptyWorkspaces });
      }
      if (p === '/api/credits' || p.endsWith('/credits')) return route.fulfill({ json: { ledger: [] } });
      return route.fulfill({ status: 403, json: { error: 'not available in UI fixture' } });
    }
    const file = path.resolve(root, '.' + (p === '/' ? '/index.html' : p));
    if (!file.startsWith(root + path.sep)) return route.abort();
    return route.fulfill({ path: file });
  });
  await page.goto('http://127.0.0.1/');
  await page.locator('[name=account]').fill('fixture');
  await page.locator('#login-password').fill('fixture-password');
  await page.locator('.login-submit').click();
  await page.locator('.geo-shell').waitFor({ state: 'visible' });
  await page.locator('[data-view-panel=overview]').waitFor({ state: 'visible' });
  return { page, errors, getCreateCount: () => createRequests };
}

try {
  // Session 1: zero workspaces. Guidance replaces the inert form; creation gives
  // immediate feedback, never double-posts, and focuses the new workspace.
  let releaseCreate;
  const deferredHandler = route => new Promise(resolve => {
    releaseCreate = async () => resolve(await route.fulfill({ json: createdWorkspace }));
  });
  const s1 = await openSession({ createHandler: deferredHandler });
  const { page, errors } = s1;
  try {
    assert.equal(await page.locator('.geo-sidebar__nav button[data-view="overview"] svg').count(), 1, 'sidebar overview entry needs an inline icon like its siblings');
    assert.ok(await page.locator('.console-empty-state img').isVisible(), 'overview empty state needs the brand mascot');
    assert.ok(await page.locator('#overview-create').isVisible(), 'overview empty state needs a create entry');

    await page.locator('.geo-sidebar__nav button[data-view="workspace"]').click();
    assert.ok(await page.locator('#workspace-empty').isVisible(), 'workspace view must show guidance when no workspace is selected');
    assert.equal(await page.locator('.geo-workspace').isVisible(), false, 'guidance must replace the raw upload form while nothing is selected');
    assert.ok(await page.locator('#empty-create').isVisible(), 'guidance needs its own create entry');

    await page.locator('#empty-create').click();
    await page.waitForFunction(() => document.getElementById('workspace-save-state')?.textContent.includes('正在创建'), null, { timeout: 3000 })
      .catch(() => { throw new Error('creation must show immediate waiting feedback'); });
    assert.equal(await page.locator('#workspace-save-state').getAttribute('aria-busy'), 'true', 'creation state must set aria-busy');
    await page.waitForTimeout(150);
    assert.equal(s1.getCreateCount(), 1, 'duplicate clicks must not send a second create request');

    await releaseCreate();
    await page.locator('[data-view-panel=workspace] .geo-workspace').waitFor({ state: 'visible' });
    assert.ok(await page.locator('#workspace-empty').isHidden(), 'guidance hides once a workspace exists');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'workspace-title', 'new workspace must be focused after creation');
    assert.equal(await page.locator('#run-task').isDisabled(), false, 'created draft must be ready for uploads');
    assert.equal(await page.locator('#task-file').isDisabled(), false, 'file input must be editable in the new draft');

    for (const [width, height, label] of [[1920, 1080, 'desktop'], [1280, 900, 'laptop'], [1280, 600, 'short viewport'], [390, 844, 'mobile']]) {
      await page.setViewportSize({ width, height });
      const dims = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      assert.ok(dims.page <= dims.client, `${label} must not scroll horizontally: ${JSON.stringify(dims)}`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => { document.body.style.zoom = '1.25'; });
    const zoomed = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(zoomed.page <= zoomed.client, `125% zoom must not scroll horizontally: ${JSON.stringify(zoomed)}`);
    await page.evaluate(() => { document.body.style.zoom = ''; });

    await page.locator('.geo-sidebar__nav button[data-view="overview"]').click();
    await page.screenshot({ path: path.join(output, 'overview-empty-desktop.png') });
    await page.locator('.geo-sidebar__nav button[data-view="workspace"]').click();
    await page.screenshot({ path: path.join(output, 'workspace-empty-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'workspace-empty-mobile.png') });
    assert.deepEqual(errors, []);
    console.log('PASS workspace feedback: overview icon+mascot, empty guidance, creation feedback, focus, responsive+zoom.');
  } finally { await page.close(); }

  // Session 2: create request fails. Reason must be visible and retry safe.
  const s2 = await openSession({
    createHandler: route => route.fulfill({ status: 500, json: { error: '模拟服务端创建失败，请稍后重试。', code: 'SERVER_ERROR' } }),
  });
  const page2 = s2.page;
  try {
    await page2.locator('.geo-sidebar__nav button[data-view="workspace"]').click();
    await page2.locator('#empty-create').click();
    await page2.waitForFunction(() => document.getElementById('workspace-save-state')?.classList.contains('is-error'), null, { timeout: 3000 })
      .catch(() => { throw new Error('failure must mark the save state as an error'); });
    assert.match(await page2.locator('#workspace-save-state').textContent(), /模拟服务端创建失败/);
    assert.equal(s2.getCreateCount(), 1, 'one click must map to one create request');
    await page2.waitForFunction(() => !document.getElementById('new-workspace').disabled, null, { timeout: 3000 });
    assert.deepEqual(s2.errors, []);
    console.log('PASS failure feedback: error reason shown, safe retry re-enabled.');
  } finally { await page2.close(); }
} finally { await browser.close(); }
