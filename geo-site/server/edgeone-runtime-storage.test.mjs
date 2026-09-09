import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandler } from './router.mjs';
import { JsonStore } from './storage.mjs';

test('Blob writes use the SDK-compatible options used by the official Cloud Function example', async () => {
  const calls = [];
  const blob = {
    async setJSON(...args) { calls.push(args); },
  };
  const store = new JsonStore(blob);

  await store.set('sessions/example', { ok: true });
  await store.create('login-attempts/example', { at: 1 });

  assert.deepEqual(calls, [
    ['sessions/example', { ok: true }],
    ['login-attempts/example', { at: 1 }, { onlyIfNew: true }],
  ]);
});

test('storage failures carry a safe operation label without changing the provider error code', async () => {
  const providerError = Object.assign(new Error('sensitive provider detail'), { code: 'COS_ERROR' });
  const store = new JsonStore({
    async get() { throw providerError; },
  });

  await assert.rejects(store.get('sessions/example'), (error) => {
    assert.equal(error.code, 'COS_ERROR');
    assert.equal(error.storageOperation, 'get');
    return true;
  });
});

test('unexpected API failures log only request metadata and safe error labels', async () => {
  const providerError = Object.assign(new Error('sensitive provider detail'), {
    code: 'COS_ERROR',
    storageOperation: 'create',
  });
  const store = {
    async create() { throw providerError; },
  };
  const env = {
    APP_ORIGIN: 'https://geo.example.test',
    GEO_ACCOUNT: 'account',
    GEO_PASSWORD_HASH: 'scrypt:' + 'a'.repeat(32) + ':' + 'b'.repeat(128),
    GEO_MASTER_KEY: 'c'.repeat(64),
  };
  const request = new Request('https://geo.example.test/api/auth/login', {
    method: 'POST',
    headers: { origin: env.APP_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ account: 'invalid', password: 'invalid' }),
  });
  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args);
  try {
    const response = await createHandler({ store, env })(request, {
      clientIp: '127.0.0.1',
      requestId: 'request-safe-id',
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'SERVER_ERROR');
  } finally {
    console.error = original;
  }

  assert.deepEqual(logs, [[
    'api_request_failed',
    {
      requestId: 'request-safe-id',
      path: 'auth/login',
      method: 'POST',
      name: 'Error',
      code: 'COS_ERROR',
      operation: 'create',
    },
  ]]);
  assert.doesNotMatch(JSON.stringify(logs), /sensitive provider detail/);
});
