import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Cloud Function statically imports Blob so EdgeOne can inject deployment credentials', () => {
  const entry = fs.readFileSync(path.join(root, 'cloud-functions', 'api', '[[path]].js'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'edgeone.json'), 'utf8'));
  const externals = config.cloudFunctions?.nodejs?.externalNodeModules ?? [];

  assert.match(entry, /import\s*\{\s*getStore\s*\}\s*from\s*['"]@edgeone\/pages-blob['"]/);
  assert.doesNotMatch(entry, /makeProductionStore/);
  assert.equal(externals.includes('@edgeone/pages-blob'), false);
});

test('storage initialization failures are logged without secret values', () => {
  const entry = fs.readFileSync(path.join(root, 'cloud-functions', 'api', '[[path]].js'), 'utf8');
  assert.match(entry, /console\.error\('blob_init_failed',\s*\{\s*name:\s*error\?\.name,\s*code:\s*error\?\.code\s*\}\)/);
  assert.doesNotMatch(entry, /console\.error\([^\n]*(message|stack)/);
  assert.match(entry, /请管理员查看此次部署的 Cloud Functions 日志/);
});

test('Cloud Function forwards the EdgeOne request UUID for safe log correlation', () => {
  const entry = fs.readFileSync(path.join(root, 'cloud-functions', 'api', '[[path]].js'), 'utf8');
  assert.match(entry, /requestId:\s*uuid/);
});
