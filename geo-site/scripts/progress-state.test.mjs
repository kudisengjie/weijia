import assert from 'node:assert/strict';
import test from 'node:test';
import { describeGitSync } from './progress-state.mjs';

test('progress labels a matching GitHub tracking ref as synchronized', () => {
  assert.equal(
    describeGitSync(0, 0, '本地缓存 origin/master'),
    '已同步：本地 HEAD 与本地缓存 origin/master 一致',
  );
});

test('progress never calls a local-only commit pushed', () => {
  assert.equal(
    describeGitSync(1, 0, 'GitHub master'),
    '未推送：本地有 1 个提交尚未进入 GitHub master',
  );
});

test('progress reports remote-only and diverged states distinctly', () => {
  assert.equal(describeGitSync(0, 2, 'GitHub master'), '本地落后：GitHub master 有 2 个新提交');
  assert.equal(describeGitSync(1, 2, 'GitHub master'), '已分叉：本地独有 1 个提交，GitHub master 独有 2 个提交');
});
