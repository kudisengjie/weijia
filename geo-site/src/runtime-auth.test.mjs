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
  assert.match(source, /createBatchRunners/);
  assert.match(source, /artifacts\/'\+encodeURIComponent/);
  assert.match(source, /batches\/\$\{b\.id\}\/pause/);
  assert.match(source, /batches\/\$\{b\.id\}\/cancel/);
});

test('model lock follows the account, not the historical batch currently viewed', () => {
  assert.equal(runtime.modelIsLocked({modelLocked:true}, {status:'completed'}), true);
  assert.equal(runtime.modelIsLocked({modelLocked:false}, {status:'cancelled'}), false);
  assert.equal(runtime.modelIsLocked({modelLocked:false}, {status:'paused'}), true);
});

test('uncertain credit submission reuses its ID, while a changed target gets a new ID', () => {
  let count=0;const id=()=>String(++count);
  const body={userId:'one',amount:5,kind:'grant',note:''};
  const first=runtime.pendingOperation(null,body,id);
  assert.equal(runtime.pendingOperation(first,body,id),first);
  assert.notEqual(runtime.pendingOperation(first,{...body,userId:'two'},id).body.idempotencyKey,first.body.idempotencyKey);
});

test('partial output is never labelled all successful', () => {
  assert.equal(runtime.batchStatusLabel({status:'completed',failedTasks:[{taskId:'2'}]}),'已结束 · 部分任务未完成');
  assert.equal(runtime.batchStatusLabel({status:'cancelled'}),'已取消');
  assert.equal(runtime.batchStatusLabel({status:'paused'}),'已暂停');
});

test('authenticated session hands the account scope to local output; logout clears it', () => {
  // 交接方案 §6.2/§12 阶段 B：登录/会话恢复注入 accountScope，登出/失效立即清空本机交付上下文。
  assert.match(source, /accountScopeFrom/);
  assert.match(source, /localOutput\.setScope\(accountScopeFrom\(data\)\)/);
  assert.match(source, /localOutput\.setScope\(null\)/);
  assert.match(source, /createLocalOutput\(/);
});

test('saving pane only enables real directory flows and never fakes a saved state', () => {
  assert.match(source, /saving-settings/);
  assert.match(source, /renderSaving/);
  assert.match(source, /本地交付将在后续版本启用/);
  assert.doesNotMatch(source, /localStorage\.(set|get)Item\('lxue\.geo\.dir/);
});
