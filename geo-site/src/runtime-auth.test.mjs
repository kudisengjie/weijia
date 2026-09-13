import assert from 'node:assert/strict';
import test from 'node:test';

const runtime = await import('./runtime.js');
const source = await (await import('node:fs/promises')).readFile(new URL('./runtime.js', import.meta.url), 'utf8');

test('runtime diagnostics identify the Python and PostgreSQL deployment', () => {
  assert.doesNotMatch(source, /Node Functions|EdgeOne Blob/);
  assert.match(source, /Python Cloud Functions/);
  assert.match(source, /PostgreSQL/);
});

test('authenticated workspace appears before settings and history bootstrap', async () => {
  assert.equal(typeof runtime.bootstrapAuthenticatedWorkspace, 'function');
  const calls = [];
  const result = await runtime.bootstrapAuthenticatedWorkspace({
    showWorkspace() { calls.push('workspace'); },
    async refreshSettings() { calls.push('settings'); },
    async loadHistory() { calls.push('history'); },
    showServiceFailure() { calls.push('failure'); },
  });
  assert.equal(result, true);
  assert.deepEqual(calls, ['workspace', 'settings', 'history']);
});

test('settings bootstrap failure stays in workspace and does not trigger duplicate storage reads', async () => {
  assert.equal(typeof runtime.bootstrapAuthenticatedWorkspace, 'function');
  const calls = [];
  const failure = Object.assign(new Error('数据存储读取失败。'), { code: 'STORAGE_GET_FAILED', requestId: 'request-1' });
  const result = await runtime.bootstrapAuthenticatedWorkspace({
    showWorkspace() { calls.push('workspace'); },
    async refreshSettings() { calls.push('settings'); throw failure; },
    async loadHistory() { calls.push('history'); },
    showServiceFailure(error) { calls.push(['failure', error.code, error.requestId]); },
  });
  assert.equal(result, false);
  assert.deepEqual(calls, ['workspace', 'settings', ['failure', 'STORAGE_GET_FAILED', 'request-1']]);
});

test('runtime uses bounded runs and server-side article artifacts', () => {
  assert.match(source, /batches\/\$\{b\.id\}\/run/);
  assert.match(source, /maxSteps:2/);
  assert.match(source, /artifacts\/'\+encodeURIComponent/);
  assert.match(source, /modelLocked=b\.status!==\'completed\'/);
});
