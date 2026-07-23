import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
  assert(content.includes('data-i18n="nav.cases">GEO策略中心</a>'), `${path} nav should label insights as GEO策略中心`);
  assert(content.includes('data-i18n="footer.cases">GEO策略中心</a>'), `${path} footer should label insights as GEO策略中心`);
  assert(content.includes('<span class="brand-name">零雪AI-Genesis</span>'), `${path} should keep the approved brand logo text`);
}

assert(i18n.includes("'nav.cases': 'GEO策略中心'"), 'Chinese nav.cases should be GEO策略中心');
assert(i18n.includes("'footer.cases': 'GEO策略中心'"), 'Chinese footer.cases should be GEO策略中心');
assert(i18n.includes("'nav.cases': 'GEO Strategy Center'"), 'English nav.cases should be GEO Strategy Center');
assert(i18n.includes("'footer.cases': 'GEO Strategy Center'"), 'English footer.cases should be GEO Strategy Center');

assert(insights.includes('<title>GEO策略中心|零雪AI|AI搜索优化与品牌可见度</title>'), 'insights title should describe the current GEO strategy page');
for (const text of ['让你的品牌成为AI回答里的可信选择', 'P.R.I.M.E策略路径', '元宝 / 腾讯生态', '豆包 / 字节生态', 'DeepSeek', '文心一言 / 百度生态']) {
  assert(insights.includes(text), `insights should visibly include ${text}`);
}
assert(insights.includes('2026-07-23T00:00:00+08:00'), 'insights modified time should match the current source update');

const match = insights.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/);
assert(match, 'insights.html should include JSON-LD');
const json = JSON.parse(match[1]);
const graph = Array.isArray(json['@graph']) ? json['@graph'] : [];
assert(graph.some((entry) => entry['@type'] === 'WebPage' && entry.name.includes('GEO策略中心')), 'JSON-LD should describe the GEO strategy page');
assert(graph.some((entry) => entry['@type'] === 'Service' && entry.name.includes('GEO')), 'JSON-LD should include the visible GEO service');
assert(!graph.some((entry) => entry['@type'] === 'FAQPage'), 'insights should not expose hidden FAQ schema');
assert(!graph.some((entry) => entry['@type'] === 'ItemList'), 'recent articles should remain centralized on the blog page');

assert(llms.includes('AI平台索引中心: https://www.lxue.xin/insights.html'), 'llms.txt should expose the strategy/index page once');
assert(llms.includes('元宝、豆包、DeepSeek、文心一言'), 'llms.txt should summarize priority AI platforms');
assert(llms.indexOf('## 近期文章（优先抓取）') < llms.indexOf('## 核心页面'), 'llms.txt should prioritize recent articles');
assert(sitemap.includes('<loc>https://www.lxue.xin/insights.html</loc>'), 'sitemap should keep the canonical URL');
assert(sitemap.includes('<lastmod>2026-07-23</lastmod>'), 'sitemap should use the real current source update');
assert(sitemap.includes('<priority>0.95</priority>'), 'sitemap should keep the strategy center among high-priority discovery URLs');

console.log('GEO strategy center validation passed');
