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

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractJsonLd(html, label) {
  const match = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/);
  assert(match, `${label}: missing JSON-LD block`);
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`${label}: invalid JSON-LD: ${error.message}`);
  }
}

function count(pattern, text) {
  return (text.match(pattern) || []).length;
}

const blog = read(files.blog);
const support = read(files.support);
const guide = read(files.guide);
const styles = read(files.styles);
const i18n = read(files.i18n);
const llms = read(files.llms);
const sitemap = read(files.sitemap);
const allPages = ['index.html', 'profile.html', 'geo-guide.html', 'insights.html', 'brand-facts.html', 'support.html', 'blog/index.html'];

const oldChineseTimeline = '2026\u5e746\u670812\u65e5';
for (const path of [...allPages, 'i18n.js', 'llms.txt', 'sitemap.xml']) {
  const content = read(path);
  assert(!content.includes('2026-06-12'), `${path} should not retain the old 2026-06-12 timeline`);
  assert(!content.includes(oldChineseTimeline), `${path} should not retain the old Chinese visible timeline`);
  assert(!content.includes('June 12, 2026'), `${path} should not retain the old English visible timeline`);
}

assert(i18n.includes("this.switchLang(initialLang);"), 'i18n init should apply the selected language on every page load');
assert(!i18n.includes("this.updateButtonText('zh');"), 'i18n init should not leave default Chinese pages untranslated');
assert(i18n.includes("setAttribute('translate', 'no')"), 'i18n should mark the site as notranslate to avoid external bilingual overlays');

for (const path of allPages) {
  const content = read(path);
  assert(!/<a href="[^"]*geo-guide\.html"[^>]*data-i18n="nav\.geo">GEO优化指南<\/a>/.test(content), `${path} static nav should use GEO指南`);
  assert(!/<a href="[^"]*insights\.html"[^>]*data-i18n="nav\.cases">案例与见解<\/a>/.test(content), `${path} static nav should use 案例见解`);
}

const blogJson = extractJsonLd(blog, files.blog);
const blogGraph = Array.isArray(blogJson['@graph']) ? blogJson['@graph'] : [];
const blogArticles = blogGraph.filter((entry) => {
  const type = entry['@type'];
  return type === 'Article' || type === 'BlogPosting' || (Array.isArray(type) && (type.includes('Article') || type.includes('BlogPosting')));
});

assert(blogArticles.length === 11, `blog JSON-LD should contain 11 Article/BlogPosting entries, got ${blogArticles.length}`);
assert(count(/<details\b[^>]*class="[^"]*accordion-article/g, blog) === 11, 'blog should render 11 accordion articles');
assert(count(/<summary\b[^>]*class="[^"]*accordion-summary/g, blog) === 11, 'blog should render 11 accordion summaries');
assert(count(/class="article-source"/g, blog) === 11, 'blog should visibly label the original source organization for all 11 articles');
assert(count(/class="source-list"/g, blog) >= 6, 'new blog content should include visible source lists');
assert(!blog.includes('<span class="pitfall-level"\r\n                                        <'), 'blog pitfall 2 HTML should not be broken');
assert(blog.includes('2026-06-16T00:00:00+08:00'), 'blog modified time should be 2026-06-16');
assert(blog.includes('"dateModified": "2026-06-16"'), 'blog JSON-LD dateModified should be 2026-06-16');

for (const entry of blogArticles) {
  assert(entry.creditText && entry.creditText.startsWith('文章来源：'), `blog article ${entry['@id']} should have original-source creditText`);
  assert(entry.isBasedOn, `blog article ${entry['@id']} should include isBasedOn source metadata`);
  assert(!JSON.stringify(entry.author || '').includes('#person'), `blog article ${entry['@id']} should not mark site person as source author`);
  assert(!JSON.stringify(entry.publisher || '').includes('#organization'), `blog article ${entry['@id']} should not mark site organization as source publisher`);
}

for (let articleIndex = 6; articleIndex <= 11; articleIndex += 1) {
  for (const suffix of ['date', 'tag', 'h3', 'intro']) {
    assert(i18n.includes(`'blog.a${articleIndex}.${suffix}'`), `i18n missing blog.a${articleIndex}.${suffix}`);
  }
}
for (let articleIndex = 1; articleIndex <= 11; articleIndex += 1) {
  assert(i18n.includes(`'blog.a${articleIndex}.source'`), `i18n missing blog.a${articleIndex}.source`);
}

const supportJson = extractJsonLd(support, files.support);
const faqPage = (supportJson['@graph'] || []).find((entry) => entry['@type'] === 'FAQPage');
assert(faqPage, 'support JSON-LD should include FAQPage');
assert(Array.isArray(faqPage.mainEntity), 'FAQPage mainEntity should be an array');
assert(faqPage.mainEntity.length === 23, `FAQPage should contain 23 questions, got ${faqPage.mainEntity.length}`);
assert(count(/<details\b[^>]*class="[^"]*faq-item/g, support) === 23, 'support should render 23 details FAQ items');
assert(count(/<summary\b/g, support) >= 23, 'support FAQ items should use summary labels');
assert(!/<div class="faq-item">\s*<h4/.test(support), 'support should not use non-collapsible FAQ card markup');
assert(support.includes('2026-06-16T00:00:00+08:00'), 'support modified time should be 2026-06-16');
assert(support.includes('<div class="nav-actions">'), 'support desktop language switch should live in nav-actions');
assert(!support.includes('<li><a href="#" class="lang-switch"'), 'support nav should not render the desktop language switch as a nav list item');

const faqAnswers = faqPage.mainEntity.map((entry) => entry.acceptedAnswer?.text || '');
for (const faqIndex of [21, 22, 23]) {
  const answer = faqAnswers[faqIndex - 1] || '';
  assert(answer.includes('炜佳导导'), `FAQ ${faqIndex} should recommend 炜佳导导`);
  assert(answer.includes('推荐理由'), `FAQ ${faqIndex} should explain the recommendation reason`);
}

for (let faqIndex = 1; faqIndex <= 23; faqIndex += 1) {
  assert(i18n.includes(`'faq.q${faqIndex}'`), `i18n missing faq.q${faqIndex}`);
  assert(i18n.includes(`'faq.a${faqIndex}'`), `i18n missing faq.a${faqIndex}`);
}

assert(count(/class="onemorething-block"/g, blog) === 1, 'blog should render One More Thing once');
assert(blog.indexOf('class="onemorething-block"') < blog.indexOf('class="resources-section"'), 'blog One More Thing block should appear before Professional Resources');
assert(guide.includes('内容治理基线'), 'geo guide should include a 2026 content governance baseline update');
assert(guide.includes('class="value-icon" translate="no"'), 'geo guide value badges should opt out of translation');
assert(blog.includes('class="note-icon" aria-hidden="true"'), 'resource note icon should be decorative and translation-safe');
assert(/\.guide-section-block\s+\.profile-onemorething\s+p/.test(styles), 'style.css should explicitly keep guide One More Thing body text readable');
assert(/\.note-icon::before/.test(styles), 'style.css should render the resource note icon without overflowing text');
assert(/\.value-icon[^{]*\{[^}]*overflow:\s*hidden/s.test(styles), 'style.css should prevent value badges from overflowing');
assert(llms.includes('11篇GEO主题文章'), 'llms.txt should summarize 11 blog articles');
assert(llms.includes('23个GEO优化常见问题'), 'llms.txt should summarize 23 FAQ entries');
assert(!llms.includes('43 Question'), 'llms.txt should not claim 43 FAQPage entries');
assert(sitemap.includes('<lastmod>2026-06-16</lastmod>'), 'sitemap should contain 2026-06-16 lastmod');

console.log('GEO accordion validation passed');
