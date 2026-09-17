import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {createArticleDelivery} = await import('./article-delivery.js');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const bytes = text => new TextEncoder().encode(text);

// —— Node fs 真实磁盘适配器：与 local-output.saveFile 相同的返回契约 ——
function diskLocalOutput(root, {tamper = false, failSave = false} = {}) {
  return {
    saved: [],
    async saveFile(segments, fileName, contents) {
      if (failSave) throw Object.assign(new Error('写入本地文件失败'), {code: 'WRITE_FAILED'});
      const payload = tamper ? bytes('被篡改的内容') : contents;
      const dir = path.join(root, ...segments);
      fs.mkdirSync(dir, {recursive: true});
      const target = path.join(dir, fileName);
      fs.writeFileSync(target, payload);
      this.saved.push(target);
      return {fileName, byteLength: payload.byteLength, sha256: sha256(payload)};
    },
  };
}

function memoryOutbox() {
  const map = new Map();
  return {
    map,
    async keys() { return [...map.keys()]; },
    async get(key) { return map.get(key) ?? null; },
    async set(key, value) { map.set(key, value); },
    async delete(key) { map.delete(key); },
  };
}

// —— 伪 API：记录请求，按脚本应答；回执成功后从待交付清单移除（模拟服务器状态转移） ——
function fakeApi({items = [], receiptPlan = () => ({status: 200, data: {billingStatus: 'settled'}})} = {}) {
  const calls = [];
  const confirmed = new Set();
  const state = {get confirmed() { return confirmed; }};
  return {
    calls, state,
    async api(pathname, body) {
      calls.push({pathname, body});
      if (pathname.startsWith('artifacts/pending')) {
        return {items: items.filter(entry => !confirmed.has(entry.artifactId)), nextCursor: null};
      }
      if (pathname.includes('/local-receipt')) {
        const plan = receiptPlan(pathname, body);
        if (plan.throw) throw plan.throw;
        if (plan.status !== 200) {
          throw Object.assign(new Error(plan.data?.error || '请求失败。'),
            {status: plan.status, code: plan.data?.code});
        }
        confirmed.add(pathname.split('/')[1]);
        // 服务器响应契约：{receipt, batch}（回执 + 唤醒后的批次状态，可为 null）。
        return {receipt: plan.data, batch: plan.batch ?? null};
      }
      throw new Error('意外路径：' + pathname);
    },
  };
}

const CONTENT = '# 完整文章\n有依据的完整正文。\n';
const item = overrides => ({
  artifactId: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
  batchId: 'batch-1',
  taskId: '1',
  filename: '1-零雪.md',
  byteLength: bytes(CONTENT).byteLength,
  sha256: sha256(bytes(CONTENT)),
  deliveryState: 'pending',
  createdAt: '2026-09-17T00:00:00+00:00',
  ...overrides,
});

const SCOPE = 'scope-abc';

async function deliveryWith({items, outbox = memoryOutbox(), receiptPlan, localOutput, onPendingChange} = {}) {
  const fake = fakeApi({items, receiptPlan});
  const output = localOutput ?? diskLocalOutput(fake.root ?? os.tmpdir());
  const delivery = createArticleDelivery({
    api: fake.api,
    download: async () => bytes(CONTENT),
    localOutput: output,
    outbox,
    accountScope: SCOPE,
    onPendingChange: onPendingChange ?? (() => {}),
  });
  return {fake, outbox, delivery, output};
}

test('end-to-end delivery downloads, writes to real disk, sends receipt and clears the outbox', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lxue-delivery-'));
  const receipts = [];
  const {fake, outbox, delivery} = await deliveryWith({
    items: [item()],
    localOutput: diskLocalOutput(root),
    receiptPlan: (url, body) => { receipts.push({url, body}); return {status: 200, data: {billingStatus: 'settled'}}; },
  });

  const result = await delivery.deliverAll();

  assert.deepEqual(result, {delivered: 1, failed: []});
  // 真实磁盘：品牌根/账号/批次/文件名
  const expected = path.join(root, '零雪GEO', SCOPE, 'batch-1', '1-零雪.md');
  assert.ok(fs.existsSync(expected), 'article must exist on real disk');
  assert.equal(fs.readFileSync(expected, 'utf8'), '# 完整文章\n有依据的完整正文。\n');
  // 回执字段：规范 UUID、服务器记录的 sha256/byteLength
  assert.equal(receipts.length, 1);
  assert.match(receipts[0].body.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(receipts[0].body.sha256, item().sha256);
  assert.equal(receipts[0].body.byteLength, bytes(CONTENT).byteLength);
  // 回执成功后 outbox 清空
  assert.equal((await outbox.keys()).length, 0);
  assert.equal(fake.calls.some(call => call.pathname.includes('local-receipt')), true);
});

test('failed receipt keeps the outbox entry; flush retries with the same requestId', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lxue-delivery-'));
  const receipts = [];
  let fail = true;
  const {outbox, delivery} = await deliveryWith({
    items: [item()],
    localOutput: diskLocalOutput(root),
    receiptPlan: (url, body) => {
      receipts.push(body);
      return fail ? {status: 503, data: {error: '网络中断'}} : {status: 200, data: {billingStatus: 'settled'}};
    },
  });

  const first = await delivery.deliverAll();
  assert.equal(first.delivered, 0);
  assert.equal(first.failed.length, 1);
  // 文件已写盘但未确认：outbox 必须保留补确认记录
  const keys = await outbox.keys();
  assert.equal(keys.length, 1);
  const stored = await outbox.get(keys[0]);
  assert.equal(stored.artifactId, item().artifactId);
  assert.equal(stored.requestId, receipts[0].requestId);

  fail = false;
  const flushed = await delivery.sync();
  assert.equal(flushed.delivered, 1);
  assert.equal((await outbox.keys()).length, 0);
  // 两次回执使用同一 requestId（幂等），哈希一致
  assert.equal(receipts.length, 2);
  assert.equal(receipts[1].requestId, receipts[0].requestId);
  assert.equal(receipts[1].sha256, receipts[0].sha256);
});

test('already-confirmed duplicate receipts are treated as success', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lxue-delivery-'));
  const outbox = memoryOutbox();
  const artifactId = item().artifactId;
  await outbox.set(`receipt:${artifactId}`, {
    artifactId, requestId: crypto.randomUUID(), sha256: item().sha256, byteLength: bytes(CONTENT).byteLength, queuedAt: 1,
  });
  const {delivery} = await deliveryWith({
    items: [],
    outbox,
    localOutput: diskLocalOutput(root),
    receiptPlan: () => ({status: 200, data: {billingStatus: 'settled', alreadyConfirmed: true}}),
  });

  const flushed = await delivery.sync();

  assert.equal(flushed.delivered, 1);
  assert.equal((await outbox.keys()).length, 0);
});

test('tampered on-disk content blocks the receipt and keeps the artifact pending', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lxue-delivery-'));
  const receipts = [];
  const {outbox, delivery} = await deliveryWith({
    items: [item()],
    localOutput: diskLocalOutput(root, {tamper: true}),
    receiptPlan: (url, body) => { receipts.push(body); return {status: 200, data: {}}; },
  });

  const result = await delivery.deliverAll();

  assert.equal(result.delivered, 0);
  assert.equal(result.failed[0].code, 'VERIFY_FAILED');
  assert.equal(receipts.length, 0, 'mismatched content must never be confirmed');
  assert.equal((await outbox.keys()).length, 0);
  assert.ok(fs.existsSync(path.join(root, '零雪GEO', SCOPE, 'batch-1', '1-零雪.md')), 'tampered file stays on disk for inspection');
});

test('save failure sends no receipt and queues nothing', async () => {
  const receipts = [];
  const {outbox, delivery} = await deliveryWith({
    items: [item()],
    localOutput: diskLocalOutput(os.tmpdir(), {failSave: true}),
    receiptPlan: (url, body) => { receipts.push(body); return {status: 200, data: {}}; },
  });

  const result = await delivery.deliverAll();

  assert.equal(result.delivered, 0);
  assert.equal(result.failed[0].code, 'WRITE_FAILED');
  assert.equal(receipts.length, 0);
  assert.equal((await outbox.keys()).length, 0);
});

test('deliverAll continues past a failed item and reports per-item outcomes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lxue-delivery-'));
  const good = item();
  const bad = item({artifactId: 'b2b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d', taskId: '2', filename: '2-坏.md'});
  const seen = [];
  const {outbox, delivery} = await deliveryWith({
    items: [good, bad],
    localOutput: diskLocalOutput(root),
    receiptPlan: (url, body) => {
      seen.push(body.sha256);
      // 坏文章：服务器拒绝（哈希不一致的极端场景），好文章正常结算。
      return seen.length === 2
        ? {status: 409, data: {error: '回执哈希或字节数与服务器记录不一致。', code: 'ARTIFACT_MISMATCH'}}
        : {status: 200, data: {billingStatus: 'settled'}};
    },
  });

  const result = await delivery.deliverAll();

  assert.equal(result.delivered, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].artifactId, bad.artifactId);
  // 失败项的补确认记录保留，成功项清空
  const keys = await outbox.keys();
  assert.equal(keys.length, 1);
  assert.equal((await outbox.get(keys[0])).artifactId, bad.artifactId);
});

test('sync flushes the outbox before listing pending and reports the count once', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lxue-delivery-'));
  const order = [];
  const outbox = memoryOutbox();
  const artifactId = item().artifactId;
  await outbox.set(`receipt:${artifactId}`, {
    artifactId, requestId: crypto.randomUUID(), sha256: item().sha256, byteLength: bytes(CONTENT).byteLength, queuedAt: 1,
  });
  const changes = [];
  const fake = fakeApi({
    items: [item()],
    receiptPlan: () => { order.push('receipt'); return {status: 200, data: {billingStatus: 'settled'}}; },
  });
  // pending 查询在清单应答前记录顺序
  const rawApi = fake.api;
  const delivery = createArticleDelivery({
    api: async (pathname, body) => {
      if (pathname.startsWith('artifacts/pending')) order.push('pending');
      return rawApi(pathname, body);
    },
    download: async () => bytes(CONTENT),
    localOutput: diskLocalOutput(root),
    outbox,
    accountScope: SCOPE,
    onPendingChange: count => changes.push(count),
  });

  const state = await delivery.sync();

  assert.deepEqual(order, ['receipt', 'pending'], 'flush before listing');
  assert.equal(state.pending, 0, 'the flushed artifact is no longer pending');
  assert.deepEqual(changes, [0]);
});

test('a 404 receipt during flush drops the stale outbox entry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lxue-delivery-'));
  const outbox = memoryOutbox();
  const artifactId = item().artifactId;
  await outbox.set(`receipt:${artifactId}`, {
    artifactId, requestId: crypto.randomUUID(), sha256: item().sha256, byteLength: bytes(CONTENT).byteLength, queuedAt: 1,
  });
  const {delivery} = await deliveryWith({
    outbox,
    localOutput: diskLocalOutput(root),
    receiptPlan: () => ({status: 404, data: {error: '文章文件不存在或不属于当前账号。', code: 'ARTIFACT_NOT_FOUND'}}),
  });

  const flushed = await delivery.sync();

  assert.equal(flushed.delivered, 0);
  assert.equal((await outbox.keys()).length, 0, 'stale entry for a vanished artifact must not block the outbox forever');
});

test('re-entrant deliverAll while busy is skipped, not duplicated', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lxue-delivery-'));
  let releaseDownload;
  const gate = new Promise(resolve => { releaseDownload = resolve; });
  const fake = fakeApi({items: [item()], receiptPlan: () => ({status: 200, data: {billingStatus: 'settled'}})});
  const delivery = createArticleDelivery({
    api: fake.api,
    download: async () => { await gate; return bytes(CONTENT); },
    localOutput: diskLocalOutput(root),
    outbox: memoryOutbox(),
    accountScope: SCOPE,
    onPendingChange: () => {},
  });

  const first = delivery.deliverAll();
  const second = await delivery.deliverAll();
  assert.equal(second.skipped, true, 'second concurrent run must be skipped');
  releaseDownload();
  const result = await first;
  assert.deepEqual(result, {delivered: 1, failed: []});
});

test('a resumed batch in the receipt response is forwarded to onBatch for UI refresh', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lxue-delivery-'));
  const batches = [];
  const {delivery} = await deliveryWith({
    items: [item()],
    localOutput: diskLocalOutput(root),
    onPendingChange: () => {},
    receiptPlan: () => ({status: 200, data: {billingStatus: 'settled'}, batch: {id: 'batch-1', status: 'completed'}}),
  });
  // 注入 onBatch 需要在创建时传入；此处通过第二实例验证。
  const fake = fakeApi({items: [], receiptPlan: () => ({status: 200, data: {billingStatus: 'settled'}, batch: {id: 'b', status: 'completed'}})});
  const outbox2 = memoryOutbox();
  await outbox2.set('receipt:' + item().artifactId, {
    artifactId: item().artifactId, requestId: crypto.randomUUID(), sha256: item().sha256,
    byteLength: bytes(CONTENT).byteLength, queuedAt: 1,
  });
  const delivery2 = createArticleDelivery({
    api: fake.api,
    download: async () => bytes(CONTENT),
    localOutput: diskLocalOutput(fs.mkdtempSync(path.join(os.tmpdir(), 'lxue-delivery-'))),
    outbox: outbox2,
    accountScope: SCOPE,
    onPendingChange: () => {},
    onBatch: batch => batches.push(batch),
  });

  await delivery2.sync();

  assert.deepEqual(batches, [{id: 'b', status: 'completed'}], 'UI must learn the resumed batch state');
});

test('unsafe server filenames are sanitized before writing to disk', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lxue-delivery-'));
  const hostile = item({filename: 'ev?l<>name.md'});
  const {delivery} = await deliveryWith({
    items: [hostile],
    localOutput: diskLocalOutput(root),
    receiptPlan: () => ({status: 200, data: {billingStatus: 'settled'}}),
  });

  const result = await delivery.deliverAll();

  assert.equal(result.delivered, 1);
  const written = fs.readdirSync(path.join(root, '零雪GEO', SCOPE, 'batch-1'));
  assert.equal(written.length, 1);
  assert.doesNotMatch(written[0], /[<>:?]/, 'forbidden characters must be stripped');
});
