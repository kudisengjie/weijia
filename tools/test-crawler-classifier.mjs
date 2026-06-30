import assert from 'node:assert/strict';

import { classifyCrawler, normalizeEdgeOneLog } from '../admin/crawler-classifier.mjs';

const cases = [
  ['Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)', 'Doubao / ByteDance'],
  ['DoubaoBot/1.0 (+https://www.doubao.com)', 'Doubao / ByteDance'],
  ['DeepSeekBot/1.0; +https://www.deepseek.com', 'DeepSeek'],
  ['TencentCrawl/1.0', 'Yuanbao / Tencent'],
  ['Baiduspider/2.0', 'Baidu'],
  ['Googlebot/2.1', 'Google'],
  ['bingbot/2.0', 'Bing'],
  ['Mozilla/5.0', 'Other']
];

for (const [ua, expected] of cases) {
  assert.equal(classifyCrawler(ua).name, expected, `${ua} should be classified as ${expected}`);
}

const normalized = normalizeEdgeOneLog({
  RequestTime: '2026-06-30T10:20:30+08:00',
  RequestUrl: 'https://www.lxue.xin/articles/deepseek-geo-evidence-density-strategy.html?from=test',
  RequestMethod: 'GET',
  EdgeResponseStatusCode: '200',
  RequestUA: 'DeepSeekBot/1.0',
  ClientIP: '203.0.113.8',
  RequestReferer: '-',
  RequestID: 'req-001',
  CacheStatus: 'HIT',
  Country: 'CN'
});

assert.equal(normalized.path, '/articles/deepseek-geo-evidence-density-strategy.html');
assert.equal(normalized.status, 200);
assert.equal(normalized.method, 'GET');
assert.equal(normalized.crawlerName, 'DeepSeek');
assert.match(normalized.ipHash, /^[a-f0-9]{16}$/);
assert.equal(normalized.region, 'CN');
assert.equal(normalized.cacheStatus, 'HIT');

console.log('Crawler classifier tests passed.');
