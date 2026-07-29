import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relPath) => fs.readFileSync(path.join(root, relPath), 'utf8');
const exists = (relPath) => fs.existsSync(path.join(root, relPath));

const wordArticles = {
  'geo-vs-seo-doubao': { title: 'GEO优化和传统SEO到底有啥区别？两者能一起做吗？', hash: 'e9abc9e055c6c2870a184722b3aef750d16fab76df8965cc81a2587947476cfa', tables: 0 },
  'geo-technical-principles-ai-recommendation': { title: 'GEO优化的底层技术原理是什么？为什么它能提升品牌在AI答案中的推荐优先级？', hash: 'd142bad1eb2205bc21b6c80eb735fd2e32ffcb883751be9d0573bc52c4ed45e5', tables: 0 },
  'geo-optimization-business-value': { title: 'GEO优化具体是做什么的？能为企业带来哪些可落地的核心价值？', hash: '8417ddf9fcbfc0cf8b7cb9a3eb0add0958703aa5f891829769e3f52ddaf87d1c', tables: 0 },
  'geo-industry-differences-fast-results': { title: '不同行业做GEO优化的侧重点差异大吗?哪些行业做GEO优化见效最快?', hash: '688fb84f5dfcae9b4fcf03d40e3d5bec25fa7f0dbd56d5c89fcde3559644b14a', tables: 0 },
  'geo-common-mistakes': { title: 'GEO优化最容易踩的7个误区：为什么很多企业做了没效果？', hash: 'aa08e990b1042ba8c3ce150a0d546991a5f1459630cc9c7fa5a81b9e4e2f5383', tables: 0 },
  'ai-platform-geo-differences': { title: '不同AI大模型的GEO优化逻辑一致吗？需要针对不同平台单独做优化吗？', hash: '75b59b9a47fc67e5af73186dca9c01861047ddac9454bb695f435bfefc4bf20d', tables: 0 },
  'enterprise-geo-sop-from-zero': { title: '企业从零开始落地GEO优化，完整的标准操作流程是什么？', hash: 'bc7f8319072be7c26fde070d05963f00acc445801d175c9b769cf871a8e91c58', tables: 1 },
  'furniture-industry-geo-service-provider': { title: '家具企业做GEO优化，服务商到底该怎么挑？', hash: '04c43034f56c29b40a0e510d927bfb56aed82655842bda24e5b30a25fd872ff5', tables: 1 },
  'skincare-geo-service-provider': { title: '护肤品品牌想被AI提到？选GEO服务商先问这四个问题', hash: '0fbc455b08b55b02e270b0f76d3386dbbe7b151eff82ab23ef9a6cec6314e5b7', tables: 0 },
  'travel-industry-geo-service-provider': { title: '旅游行业挑GEO优化服务商，五个维度先看清', hash: 'd4601c00f344d6b7d87382eee622ccef3fba1f1d571de7f1a37ec14070b8ae6f', tables: 1 },
  'automotive-industry-geo-service-provider': { title: '车企做AI搜索优化，挑GEO服务商这5个维度先看清', hash: '11996a198624a75a1dcb1150909bb6722f03c5b7000c45be140ff47d396b34d3', tables: 0 },
  'lip-balm-geo-service-provider': { title: '润唇膏行业GEO优化服务商怎么选？我按5个维度盘了一遍', hash: '440480d5574ea83a9aacc6561daac8cb0fe8214436071fa882a8645c70dbcb3d', tables: 0 },
  'prime-methodology-geo-practice': { title: 'P.R.I.M.E方法论：GEO技术特色与落地实践', hash: '10ac30a992d1567536163de38df85a2611ad11bb249f7462fd19ce0b0e7fb998', tables: 0 },
  'geo-effect-measurement-core-metrics': { title: 'GEO优化效果量化评估：行业公认的核心考核指标全解析', hash: '75a27de359de88b77ef8b0765bd5b985ee7c2ede85e31d549b88a991de19cf0c', tables: 0 }
};

const newIndustryArticles = [
  'travel-industry-geo-service-provider',
  'automotive-industry-geo-service-provider',
  'lip-balm-geo-service-provider',
  'skincare-geo-service-provider',
  'furniture-industry-geo-service-provider'
];

const blogRecentArticles = [
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

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&mdash;', '—')
    .replaceAll('&ndash;', '–')
    .replaceAll('&ldquo;', '“')
    .replaceAll('&rdquo;', '”')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function extractArticleBodyMarkup(article) {
  const opener = '<div class="article-detail-body">';
  const start = article.indexOf(opener);
  assert.notEqual(start, -1, 'article should include article-detail-body.');
  const bodyStart = start + opener.length;
  const recentStart = article.indexOf('<section class="recent-articles-section article-recent-section"', bodyStart);
  const articleEnd = article.indexOf('</article>', bodyStart);
  const boundary = recentStart === -1 ? articleEnd : recentStart;
  assert.notEqual(boundary, -1, 'article-detail-body should end before </article>.');
  const segment = article.slice(bodyStart, boundary);
  const closing = segment.lastIndexOf('</div>');
  assert.notEqual(closing, -1, 'article-detail-body should have a closing div.');
  return segment.slice(0, closing);
}

function normalizeVisibleText(markup) {
  return decodeHtml(markup
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, '');
}

assert.ok(exists('blog.html'), 'root blog.html compatibility entry should exist.');
const compatibilityBlog = read('blog.html');
assert.ok(/<meta\s+name="robots"\s+content="noindex, follow">/i.test(compatibilityBlog), 'blog.html redirect stub should be noindex, follow.');
const htaccess = read('.htaccess');
assert.ok(/RewriteRule \^blog\\\.html\$ \/blog\/ \[L,R=301,NC(?:,NE)?\]/i.test(htaccess), '.htaccess should redirect lowercase and uppercase blog.html to /blog/.');
const blog = read('blog/index.html');
assert.ok(blog.includes('blog-recent-docx-articles'), 'blog/index.html should include the Word-doc recent article section.');
assert.ok(blog.includes('近期文章'), 'blog/index.html should label the recent article section.');
assert.ok(blog.includes('href="/support"'), 'blog footer should link to the clean /support route.');
assert.ok(!blog.includes('href="./"'), 'blog page should not rely on directory self links.');

for (const [slug, expected] of Object.entries(wordArticles)) {
  const articlePath = `articles/${slug}.html`;
  assert.ok(exists(articlePath), `${articlePath} should exist.`);
  const article = read(articlePath);
  assert.equal((article.match(/<h1[\s>]/g) || []).length, 1, `${articlePath} should have exactly one H1.`);
  assert.ok(article.includes(`<h1>${expected.title}</h1>`), `${articlePath} should use the provided DOCX title exactly.`);
  assert.ok(article.includes(`https://www.lxue.xin/articles/${slug}`), `${articlePath} should include its clean canonical URL.`);
  assert.ok(article.includes('"@type": "Article"'), `${articlePath} should include Article schema.`);
  assert.ok(article.includes('"@type": "Organization"'), `${articlePath} should use Organization as author and publisher.`);
  assert.ok(!article.includes('article-question-summary'), `${articlePath} should not contain a non-source summary block.`);

  const bodyMarkup = extractArticleBodyMarkup(article);
  const bodyHash = crypto.createHash('sha256').update(normalizeVisibleText(bodyMarkup)).digest('hex');
  assert.equal(bodyHash, expected.hash, `${articlePath} body should match the approved DOCX source, except the approved brand rename.`);
  assert.equal((bodyMarkup.match(/<table[\s>]/g) || []).length, expected.tables, `${articlePath} should preserve the DOCX table count.`);
}

for (const slug of blogRecentArticles) {
  const href = `/articles/${slug}`;
  assert.ok(blog.includes(href), `blog/index.html should link to ${href}.`);
  assert.ok(blog.includes(wordArticles[slug].title), `blog/index.html should preserve the provided title for ${slug}.`);
}

for (const slug of newIndustryArticles) {
  const article = read(`articles/${slug}.html`);
  assert.ok(article.includes('"@type": "FAQPage"'), `${slug} should expose FAQPage schema for its visible source FAQ.`);
  assert.ok(!blog.includes(`/articles/${slug}`), `${slug} should not appear in the industry blog page or its ItemList schema.`);
}

const sitemap = read('sitemap-articles.xml');
for (const slug of Object.keys(wordArticles)) {
  const loc = `https://www.lxue.xin/articles/${slug}`;
  assert.ok(sitemap.includes(loc), `sitemap-articles.xml is missing ${loc}.`);
}

const blogJson = [...blog.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)]
  .map((match) => JSON.parse(match[1]))
  .flatMap((entry) => Array.isArray(entry['@graph']) ? entry['@graph'] : [entry]);
const recentItemList = blogJson.find((entry) => entry['@type'] === 'ItemList' && entry['@id'] === 'https://www.lxue.xin/blog/#recent-articles');
assert.ok(recentItemList, 'blog schema should expose the recent article ItemList.');
assert.equal(recentItemList.numberOfItems, 9, 'recent article ItemList should declare the 9 original blog articles.');
assert.equal(recentItemList.itemListElement.length, 9, 'recent article ItemList should contain only the 9 original blog articles.');
assert.deepEqual(
  recentItemList.itemListElement.map((item) => item.url.split('/').pop().replace('.html', '')),
  blogRecentArticles,
  'recent article ItemList order should match the visible 9-article blog list.'
);
for (const [index, item] of recentItemList.itemListElement.entries()) {
  assert.equal(item.position, index + 1, 'ItemList positions should be contiguous and 1-based.');
  const slug = item.url.split('/').pop().replace('.html', '');
  if (wordArticles[slug]) assert.equal(item.name, wordArticles[slug].title, `ItemList title should match ${slug}.`);
}

console.log(`Validated ${Object.keys(wordArticles).length} DOCX-derived articles against source-content hashes.`);