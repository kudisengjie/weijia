import fs from 'node:fs';

const files = {
  blog: 'blog/index.html',
  support: 'support.html',
  guide: 'geo-guide.html',
  styles: 'style.css',
  i18n: 'i18n.js',
  llms: 'llms.txt',
  sitemap: 'sitemap.xml',
};
const read = (path) => fs.readFileSync(path, 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const extractJsonLd = (html, label) => {
  const match = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/);
  assert(match, `${label}: missing JSON-LD block`);
  return JSON.parse(match[1]);
};
const count = (pattern, text) => (text.match(pattern) || []).length;

const blog = read(files.blog);
const support = read(files.support);
const guide = read(files.guide);
const styles = read(files.styles);
const i18n = read(files.i18n);
const llms = read(files.llms);
const sitemap = read(files.sitemap);
const allPages = ['index.html', 'profile.html', 'geo-guide.html', 'insights.html', 'brand-facts.html', 'support.html', 'blog/index.html'];

for (const path of [...allPages, 'i18n.js', 'llms.txt', 'sitemap.xml']) {
  const content = read(path);
  assert(!content.includes('2026-06-12'), `${path} should not retain the old source date`);
  assert(!content.includes('炜佳导导是零雪AI'), `${path} should not restore the removed person/CEO narrative`);
}
assert(i18n.includes('this.switchLang(initialLang);'), 'i18n init should apply the selected language on load');
assert(!i18n.includes("this.updateButtonText('zh');"), 'i18n init should not leave default Chinese pages untranslated');
assert(i18n.includes("setAttribute('translate', 'no')"), 'i18n should prevent external bilingual overlays');

for (const path of allPages) {
  const content = read(path);
  assert(content.includes('data-i18n="nav.cases">GEO策略中心</a>'), `${path} should use the current strategy navigation label`);
  assert(content.includes('<span class="brand-name">零雪AI-Genesis</span>'), `${path} should keep the approved logo copy`);
}

const blogJson = extractJsonLd(blog, files.blog);
const blogGraph = Array.isArray(blogJson['@graph']) ? blogJson['@graph'] : [];
const recent = blogGraph.find((entry) => entry['@type'] === 'ItemList' && entry['@id'] === 'https://www.lxue.xin/blog/#recent-articles');
assert(recent && recent.numberOfItems === 9 && recent.itemListElement.length === 9, 'blog JSON-LD should expose only the 9 original visible recent articles');
assert(count(/<a class="recent-article-item"/g, blog) === 9, 'blog should visibly render only the 9 original recent article links');
assert(blog.includes('2026-07-23T00:00:00+08:00'), 'blog modified time should match the current source update');

const supportJson = extractJsonLd(support, files.support);
const faqPage = (supportJson['@graph'] || []).find((entry) => entry['@type'] === 'FAQPage');
assert(faqPage && Array.isArray(faqPage.mainEntity), 'support JSON-LD should include FAQPage');
assert(faqPage.mainEntity.length === 23, `support FAQPage should mirror the 23 visible questions, got ${faqPage.mainEntity.length}`);
assert(count(/<div class="faq-item">/g, support) === 23, 'support should render 23 visible FAQ items');
assert(!/炜佳导导(?!GEO)/.test(support), 'support should use the old phrase only inside the approved social account handle');
for (let index = 1; index <= 23; index += 1) {
  assert(i18n.includes(`'faq.q${index}'`), `i18n missing faq.q${index}`);
  assert(i18n.includes(`'faq.a${index}'`), `i18n missing faq.a${index}`);
}

assert(count(/class="onemorething-block"/g, blog) === 1, 'blog should render One More Thing once');
assert(blog.indexOf('class="onemorething-block"') < blog.indexOf('class="recent-articles-section blog-recent-docx-articles"'), 'blog One More Thing block should appear before the prioritized recent articles');
assert(guide.includes('<title>GEO优化指南|零雪AI|GEO优化|GEO战略技术研发</title>'), 'geo guide should expose the current brand title');
assert(guide.includes('<h1 class="page-title" data-i18n="guide.h2">GEO优化指南</h1>'), 'geo guide should expose one semantic page title');
for (const section of ['GEO的核心价值', 'GEO优化核心原则', 'GEO优化实施路径', 'GEO vs SEO：本质区别与协同策略']) {
  assert(guide.includes(section), `geo guide should visibly include ${section}`);
}
assert(llms.includes('23个可见问答'), 'llms.txt should state the visible FAQ count');
assert(!llms.includes('11篇GEO主题文章'), 'llms.txt should not retain the obsolete article count');
assert(sitemap.includes('<lastmod>2026-07-23</lastmod>'), 'sitemap should use the real current source date');

console.log('Current GEO content validation passed');
