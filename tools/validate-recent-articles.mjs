import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const articles = [
  'what-is-geo-vs-seo',
  'ai-search-2026-trends',
  'geo-kpi-measurement',
  'eeat-authority-building',
  'six-ai-platform-strategies',
  'schema-structured-data',
  'geo-compliance-data-governance',
  'ai-agent-content-strategy',
  'entity-optimization-knowledge-graph',
  'geo-vendor-selection',
  'lingxue-ai-prime-sgfe',
  'geo-commercial-closed-loop'
];

const newIndustryArticles = [
  'travel-industry-geo-service-provider',
  'automotive-industry-geo-service-provider',
  'lip-balm-geo-service-provider',
  'skincare-geo-service-provider',
  'furniture-industry-geo-service-provider'
];

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const support = read('support.html');
const recentIndex = support.indexOf('recent-articles-section');
const q23Index = support.indexOf('data-i18n="faq.q23"');
assert(recentIndex !== -1, 'support.html is missing the recent articles section.');
assert(q23Index !== -1 && q23Index < recentIndex, 'recent articles section must appear after Q23.');

for (let index = 0; index < articles.length; index += 1) {
  const slug = articles[index];
  const href = `/articles/${slug}`;
  assert(support.includes(href), `support.html is missing ${href}.`);
  assert(support.includes(`>${index + 1}</span>`), `support.html is missing list number ${index + 1}.`);

  const articlePath = `articles/${slug}.html`;
  const article = read(articlePath);
  assert(article.includes('<article class="article-detail"'), `${articlePath} is missing article detail markup.`);
  assert(article.includes('零雪AI'), `${articlePath} should expose the organization author/brand.`);
  assert(article.includes('2026-06-29'), `${articlePath} should use the current iteration date.`);
  const breadcrumbMatch = article.match(/<div class="article-breadcrumb">([\s\S]*?)<\/div>/);
  assert(breadcrumbMatch, `${articlePath} is missing a visible breadcrumb.`);
  assert(!breadcrumbMatch[1].includes('blog/index.html'), `${articlePath} breadcrumb should not route recent articles through the blog.`);
  assert(!breadcrumbMatch[1].includes('\u884c\u4e1a\u535a\u5ba2'), `${articlePath} breadcrumb should use the neutral recent-article path, not industry blog.`);
  assert(breadcrumbMatch[1].includes('\u8fd1\u671f\u6587\u7ae0'), `${articlePath} breadcrumb should identify the page as a recent article.`);
  assert(!article.includes('<a href="../blog/index.html" class="active">\u884c\u4e1a\u535a\u5ba2</a>'), `${articlePath} should not highlight the blog nav for support recent articles.`);
}

const articleFiles = fs.readdirSync(path.join(root, 'articles')).filter((file) => file.endsWith('.html'));
for (const file of articleFiles) {
  const articlePath = `articles/${file}`;
  const article = read(articlePath);
  const recentLinks = article.match(/class="recent-article-item"/g) || [];
  if (file === 'geo-common-mistakes.html') {
    assert(article.includes('article-recent-section'), `${articlePath} should include the only article-bottom recent section.`);
    assert(recentLinks.length === 5, `${articlePath} should expose exactly five recent article links.`);
  } else {
    assert(!article.includes('article-recent-section'), `${articlePath} should not include an article-bottom recent section.`);
    assert(recentLinks.length === 0, `${articlePath} should not duplicate the five recent article links.`);
  }
}

for (const slug of newIndustryArticles) {
  const articlePath = `articles/${slug}.html`;
  assert(fs.existsSync(path.join(root, articlePath)), `${articlePath} should exist.`);
}

const sitemap = read('sitemap-articles.xml');
for (const slug of [...articles, ...newIndustryArticles]) {
  const loc = `https://www.lxue.xin/articles/${slug}`;
  assert(sitemap.includes(loc), `sitemap-articles.xml is missing ${loc}.`);
}

for (const slug of newIndustryArticles) {
  const loc = `https://www.lxue.xin/articles/${slug}`;
  const escapedLoc = loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const urlBlock = sitemap.match(new RegExp(`<url>\\s*<loc>${escapedLoc}</loc>[\\s\\S]*?</url>`));
  assert(urlBlock, `sitemap-articles.xml is missing the URL block for ${slug}.`);
  assert(urlBlock[0].includes('<priority>1.0</priority>'), `${slug} should use sitemap priority 1.0.`);
}

const css = read('style.css');
assert(
  !/@import\s+url\([^)]*fonts\.googleapis\.com/s.test(css),
  'style.css should not block first paint on a remote font import.'
);
assert(
  /\.article-recent-section \.recent-article-list\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%/s.test(css),
  'The article-bottom recent list should be constrained to the article content width.'
);
assert(
  /\.article-table-wrap\s*>\s*table[\s\S]*?margin:\s*0/s.test(css),
  'Tables inside article-table-wrap should not inherit the global outer margin.'
);
assert(
  /\.profile-section \.ai-platform-topics\s*\{[^}]*max-width:\s*none/s.test(css),
  'The AI platform topics block should align with the full brand-detail container width.'
);assert(
  /\.profile-section \.container\s*\{[^}]*padding-left:\s*0[^}]*padding-right:\s*0/s.test(css),
  'The brand-detail container should not inset text modules from the carousel edges.'
);
console.log(`Validated ${articles.length} recent article pages and support links.`);
