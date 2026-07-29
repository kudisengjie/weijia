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
  assert(content.includes('data-i18n="nav.cases">GEO策略</a>'), `${path} nav should label insights as GEO策略`);
  assert(content.includes('data-i18n="footer.cases">GEO策略</a>'), `${path} footer should label insights as GEO策略`);
  assert(content.includes('data-i18n="nav.faq">AI问答</a>'), `${path} nav should label support as AI问答`);
  assert(content.includes('<span class="brand-name">零雪AI-Genesis</span>'), `${path} should keep the approved brand logo text`);
}

assert(i18n.includes("'nav.cases': 'GEO策略'"), 'Chinese nav.cases should be GEO策略');
assert(i18n.includes("'footer.cases': 'GEO策略'"), 'Chinese footer.cases should be GEO策略');
assert(i18n.includes("'nav.faq': 'AI问答'"), 'Chinese nav.faq should be AI问答');
assert(i18n.includes("'footer.faq': 'AI问答'"), 'Chinese footer.faq should be AI问答');

assert(insights.includes('<title>GEO策略|零雪AI|六大AI平台搜索优化策略</title>'), 'insights title should describe the current GEO strategy page');
for (const text of ['让你的品牌成为AI回答里的可信选择', 'P.R.I.M.E策略路径', '元宝 / 腾讯生态', '豆包 / 字节生态', 'DeepSeek', '文心一言 / 百度生态', '通义千问 / 阿里生态', 'Kimi / 长文本问答']) {
  assert(insights.includes(text), `insights should visibly include ${text}`);
}
assert(insights.includes('2026-07-26T00:00:00+08:00'), 'insights modified time should match the current source update');

const match = insights.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/);
assert(match, 'insights.html should include JSON-LD');
const json = JSON.parse(match[1]);
const graph = Array.isArray(json['@graph']) ? json['@graph'] : [];
assert(graph.some((entry) => entry['@type'] === 'WebPage' && entry.name.includes('GEO策略')), 'JSON-LD should describe the GEO strategy page');
assert(graph.some((entry) => entry['@type'] === 'Service' && entry.name.includes('GEO')), 'JSON-LD should include the visible GEO service');
assert(!graph.some((entry) => entry['@type'] === 'FAQPage'), 'insights should not expose hidden FAQ schema');
assert(!graph.some((entry) => entry['@type'] === 'ItemList'), 'recent articles should remain centralized on the blog page');

assert(llms.includes('### 2.2 P.R.I.M.E 五步方法') && llms.includes('平台差异与持续复测'), 'llms.txt should explain the GEO strategy framework');
for (const platform of ['豆包', 'DeepSeek', '腾讯元宝', '通义千问', '文心一言', 'Kimi']) assert(llms.includes(platform), `llms.txt should explain the ${platform} public-content scope`);
assert(llms.includes('https://www.lxue.xin/sitemap-articles.xml'), 'llms.txt should delegate article discovery to the article sitemap');
assert(sitemap.includes('<loc>https://www.lxue.xin/insights</loc>'), 'sitemap should keep the clean canonical URL');
assert(sitemap.includes('<lastmod>2026-07-26</lastmod>'), 'sitemap should use the real current source update');
assert(sitemap.includes('<priority>0.95</priority>'), 'sitemap should keep the strategy center among high-priority discovery URLs');

console.log('GEO strategy center validation passed');
