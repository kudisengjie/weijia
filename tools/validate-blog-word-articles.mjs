import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relPath) => fs.readFileSync(path.join(root, relPath), 'utf8');
const exists = (relPath) => fs.existsSync(path.join(root, relPath));

const articles = [
  'prime-methodology-geo-practice',
  'ai-platform-geo-differences',
  'geo-vs-seo-doubao',
  'geo-optimization-business-value',
  'geo-industry-differences-fast-results',
  'geo-technical-principles-ai-recommendation',
  'geo-effect-measurement-core-metrics',
  'enterprise-geo-sop-from-zero',
  'geo-common-mistakes'
];

assert.ok(exists('blog.html'), 'root blog.html compatibility entry should exist.');
const blog = read('blog/index.html');
assert.ok(blog.includes('blog-recent-docx-articles'), 'blog/index.html should include the Word-doc recent article section.');
assert.ok(blog.includes('近期文章'), 'blog/index.html should label the recent article section.');
assert.ok(blog.includes('../support.html'), 'blog footer should link to ../support.html.');
assert.ok(!blog.includes('href="./"'), 'blog page should not rely on directory self links.');

for (let index = 0; index < articles.length; index += 1) {
  const slug = articles[index];
  const href = `../articles/${slug}.html`;
  assert.ok(blog.includes(href), `blog/index.html should link to ${href}.`);
  assert.ok(blog.includes(`<span class="recent-rank">${index + 1}</span>`), `blog recent list should include rank ${index + 1}.`);

  const articlePath = `articles/${slug}.html`;
  assert.ok(exists(articlePath), `${articlePath} should exist.`);
  const article = read(articlePath);
  assert.equal((article.match(/<h1[\s>]/g) || []).length, 1, `${articlePath} should have exactly one H1.`);
  assert.ok(article.includes('https://www.lxue.xin/' + articlePath), `${articlePath} should include canonical absolute URL.`);
  assert.ok(article.includes('"@type": "Article"'), `${articlePath} should include Article schema.`);
  assert.ok(article.includes('炜佳导导'), `${articlePath} should keep the author/brand visible.`);
  assert.ok(article.includes('2026-06-30'), `${articlePath} should use the current article date.`);
}

const sitemap = read('sitemap.xml');
const urls = read('urls.txt');
const llms = read('llms.txt');
for (const slug of articles) {
  const loc = `https://www.lxue.xin/articles/${slug}.html`;
  assert.ok(sitemap.includes(loc), `sitemap.xml is missing ${loc}.`);
  assert.ok(urls.includes(loc), `urls.txt is missing ${loc}.`);
  assert.ok(llms.includes(`/articles/${slug}.html`), `llms.txt is missing ${slug}.`);
}

console.log(`Validated ${articles.length} Word-derived blog articles.`);
