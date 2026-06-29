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
  'weijia-daodao-prime-sgfe',
  'geo-commercial-closed-loop'
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
  const href = `articles/${slug}.html`;
  assert(support.includes(href), `support.html is missing ${href}.`);
  assert(support.includes(`>${index + 1}</span>`), `support.html is missing list number ${index + 1}.`);

  const articlePath = `articles/${slug}.html`;
  const article = read(articlePath);
  assert(article.includes('<article class="article-detail"'), `${articlePath} is missing article detail markup.`);
  assert(article.includes('炜佳导导'), `${articlePath} should keep the site author/brand visible.`);
  assert(article.includes('2026-06-29'), `${articlePath} should use the current iteration date.`);
}

const sitemap = read('sitemap.xml');
const urls = read('urls.txt');
for (const slug of articles) {
  const loc = `https://www.lxue.xin/articles/${slug}.html`;
  assert(sitemap.includes(loc), `sitemap.xml is missing ${loc}.`);
  assert(urls.includes(loc), `urls.txt is missing ${loc}.`);
}

console.log(`Validated ${articles.length} recent article pages and support links.`);
