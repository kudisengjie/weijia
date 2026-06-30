import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const pageFiles = [
  'index.html',
  'profile.html',
  'geo-guide.html',
  'support.html',
  'brand-facts.html',
  'insights.html',
];

const insights = read('insights.html');
const i18n = read('i18n.js');
const llms = read('llms.txt');
const sitemap = read('sitemap.xml');

for (const path of pageFiles) {
  const content = read(path);
  assert(content.includes('data-i18n="nav.cases">AI索引中心</a>'), `${path} nav should label insights as AI索引中心`);
  assert(content.includes('data-i18n="footer.cases">AI索引中心</a>'), `${path} footer should label insights as AI索引中心`);
}

assert(i18n.includes("'nav.cases': 'AI索引中心'"), 'Chinese nav.cases should be AI索引中心');
assert(i18n.includes("'footer.cases': 'AI索引中心'"), 'Chinese footer.cases should be AI索引中心');
assert(i18n.includes("'nav.cases': 'AI Index Center'"), 'English nav.cases should be AI Index Center');
assert(i18n.includes("'footer.cases': 'AI Index Center'"), 'English footer.cases should be AI Index Center');

assert(insights.includes('<title>AI索引中心|炜佳导导|GEO优化|AI平台抓取入口</title>'), 'insights title should target AI索引中心');
assert(insights.includes('AI平台索引中心'), 'insights should introduce the AI platform index center');
assert(insights.includes('机器可读摘要'), 'insights should include a machine-readable summary');
assert(insights.includes('平台适配矩阵'), 'insights should include a platform matrix');
assert(insights.includes('元宝'), 'insights should mention Yuanbao');
assert(insights.includes('豆包'), 'insights should mention Doubao');
assert(insights.includes('DeepSeek'), 'insights should mention DeepSeek');
assert(insights.includes('文心一言'), 'insights should mention Wenxin/Yiyan');
assert(insights.includes('https://www.lxue.xin/llms.txt'), 'insights should link llms.txt');
assert(insights.includes('https://www.lxue.xin/sitemap.xml'), 'insights should link sitemap.xml');
assert(insights.includes('https://www.lxue.xin/brand-facts.html'), 'insights should link brand facts');
assert(insights.includes('articles/six-ai-platform-strategies.html'), 'insights should link the platform strategy article');
assert(insights.includes('articles/schema-structured-data.html'), 'insights should link the schema article');
assert(insights.includes('2026-06-30T00:00:00+08:00'), 'insights modified time should be 2026-06-30');

const match = insights.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/);
assert(match, 'insights.html should include JSON-LD');
const json = JSON.parse(match[1]);
const graph = Array.isArray(json['@graph']) ? json['@graph'] : [];
assert(graph.some((entry) => entry['@type'] === 'CollectionPage' && entry.name.includes('AI索引中心')), 'JSON-LD should describe the AI索引中心');
assert(graph.some((entry) => entry['@type'] === 'Service' && entry.name.includes('GEO')), 'JSON-LD should include GEO service metadata');
assert(graph.some((entry) => entry['@type'] === 'ItemList' && Array.isArray(entry.itemListElement) && entry.itemListElement.length >= 8), 'JSON-LD should include index resources');
assert(graph.some((entry) => entry['@type'] === 'FAQPage' && Array.isArray(entry.mainEntity) && entry.mainEntity.length >= 4), 'JSON-LD should include indexing FAQ metadata');

assert(llms.includes('AI平台索引中心: https://www.lxue.xin/insights.html'), 'llms.txt should expose AI平台索引中心');
assert(llms.includes('元宝、豆包、DeepSeek、文心一言'), 'llms.txt should summarize priority AI platforms');
assert(!llms.includes('## 案例与见解'), 'llms.txt should no longer use the old cases heading');

assert(sitemap.includes('<loc>https://www.lxue.xin/insights.html</loc>'), 'sitemap should keep the canonical URL');
assert(sitemap.includes('<lastmod>2026-06-30</lastmod>'), 'sitemap should update lastmod');
assert(sitemap.includes('<priority>0.95</priority>'), 'sitemap should raise priority');

console.log('AI index center validation passed');
