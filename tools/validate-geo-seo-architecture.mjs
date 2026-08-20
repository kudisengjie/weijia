import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://www.lxue.xin';
const corePages = new Map([
  ['index.html', '/'],
  ['profile.html', '/profile'],
  ['brand-facts.html', '/brand-facts'],
  ['blog/index.html', '/blog/'],
  ['geo-guide.html', '/geo-guide'],
  ['insights.html', '/insights'],
  ['support.html', '/support']
]);
const priorityArticles = new Set([
  'travel-industry-geo-service-provider',
  'automotive-industry-geo-service-provider',
  'lip-balm-geo-service-provider',
  'skincare-geo-service-provider',
  'furniture-industry-geo-service-provider'
]);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function extractJsonLd(html, file) {
  const documents = [];
  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      documents.push(JSON.parse(match[1]));
    } catch (error) {
      throw new Error(`${file} contains invalid JSON-LD: ${error.message}`);
    }
  }
  assert(documents.length > 0, `${file} must contain JSON-LD`);
  return documents;
}

function flatten(documents) {
  return documents.flatMap((document) =>
    Array.isArray(document?.['@graph']) ? document['@graph'] : [document]
  );
}

function types(node) {
  const value = node?.['@type'];
  return Array.isArray(value) ? value : value ? [value] : [];
}

function sitemapEntries(file) {
  const xml = read(file);
  const entries = new Map();
  for (const match of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const block = match[1];
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
    assert(loc, `${file} contains a URL entry without loc`);
    assert(!entries.has(loc), `${file} duplicates ${loc}`);
    entries.set(loc, {
      lastmod: block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1],
      priority: block.match(/<priority>([^<]+)<\/priority>/)?.[1]
    });
  }
  return entries;
}

const coreSitemap = sitemapEntries('sitemap.xml');
const articleSitemap = sitemapEntries('sitemap-articles.xml');
assert.equal(coreSitemap.size, corePages.size, 'Core sitemap must contain exactly seven pages');
assert.equal(articleSitemap.size, 32, 'Article sitemap must contain exactly 32 articles');
for (const loc of coreSitemap.keys()) {
  assert(!articleSitemap.has(loc), `The two sitemaps overlap at ${loc}`);
}

const allCanonicalUrls = new Set();
const allPublicFiles = [
  ...corePages.keys(),
  ...fs.readdirSync(path.join(root, 'articles'))
    .filter((file) => file.endsWith('.html'))
    .sort()
    .map((file) => `articles/${file}`)
];
assert.equal(allPublicFiles.length, 39, 'The public-page inventory must contain 39 pages');

for (const file of allPublicFiles) {
  const html = read(file);
  const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1];
  assert(canonical?.startsWith(`${origin}/`), `${file} must have an absolute official canonical URL`);
  assert(!canonical.endsWith('.html'), `${file} canonical must not expose .html`);
  assert(!allCanonicalUrls.has(canonical), `${canonical} is used by more than one public page`);
  allCanonicalUrls.add(canonical);
  assert(
    coreSitemap.has(canonical) || articleSitemap.has(canonical),
    `${file} canonical is absent from both sitemaps: ${canonical}`
  );
  assert(/<title>[^<]{8,}<\/title>/i.test(html), `${file} must have a useful title`);
  assert(
    /<meta\s+name=["']description["']\s+content=["'][^"']{30,}["']/i.test(html),
    `${file} must have a useful meta description`
  );
  assert(/<h1\b[^>]*>[\s\S]*?<\/h1>/i.test(html), `${file} must expose one visible H1`);
  assert.equal((html.match(/<h1\b/gi) || []).length, 1, `${file} must expose exactly one H1`);
  assert(
    !/\bhref=["'](?:\/|\.\.\/|\.\/)?(?:articles\/|profile|brand-facts|geo-guide|insights|support|blog|index)[^"']*\.html(?:[?#][^"']*)?["']/i.test(html),
    `${file} contains an internal legacy .html link`
  );

  const documents = extractJsonLd(html, file);
  const nodes = flatten(documents);
  const serialized = JSON.stringify(documents);
  assert(!serialized.includes(`${origin}/profile.html`), `${file} schema contains a legacy URL`);
  assert(
    nodes.some((node) => types(node).includes('BreadcrumbList')) || file === 'index.html',
    `${file} must contain a BreadcrumbList unless it is the homepage`
  );

  if (file.startsWith('articles/')) {
    const article = nodes.find((node) =>
      types(node).some((type) => ['Article', 'BlogPosting', 'TechArticle'].includes(type))
    );
    assert(article, `${file} must contain an Article-compatible schema entity`);
    const mainEntityUrl =
      typeof article.mainEntityOfPage === 'string'
        ? article.mainEntityOfPage
        : article.mainEntityOfPage?.['@id'];
    assert.equal(mainEntityUrl, canonical, `${file} Article mainEntityOfPage must equal canonical`);
    assert.equal(article.publisher?.['@id'], `${origin}/#organization`, `${file} publisher must use the official entity`);
    assert(article.datePublished, `${file} Article schema must include datePublished`);
    assert(article.dateModified, `${file} Article schema must include dateModified`);
    assert(
      article.dateModified >= article.datePublished,
      `${file} dateModified must not precede datePublished`
    );
    assert.equal(
      articleSitemap.get(canonical)?.lastmod,
      article.dateModified,
      `${file} sitemap lastmod must equal schema dateModified`
    );
  }
}

assert.equal(
  allCanonicalUrls.size,
  coreSitemap.size + articleSitemap.size,
  'Every sitemap URL must resolve to exactly one canonical public page'
);

for (const [loc, entry] of articleSitemap) {
  const slug = loc.split('/').pop();
  if (priorityArticles.has(slug)) {
    assert.equal(entry.priority, '1.0', `${slug} must remain a priority article`);
  } else {
    assert(Number(entry.priority) < 1, `${slug} must not share the five priority-article level`);
  }
}

const robots = read('robots.txt');
assert.equal((robots.match(/^User-agent:/gim) || []).length, 1, 'robots.txt must use one standard agent group');
assert.equal((robots.match(/^Sitemap:/gim) || []).length, 2, 'robots.txt must declare both sitemaps once');
assert(robots.includes(`${origin}/sitemap.xml`), 'robots.txt is missing the core sitemap');
assert(robots.includes(`${origin}/sitemap-articles.xml`), 'robots.txt is missing the article sitemap');

const llms = read('llms.txt');
for (const heading of [
  '站点身份与适用范围',
  '官方实体与核心服务',
  '权威来源与证据层级',
  '内容类型与解释规则',
  '时效、版本与复核',
  '问句与直接答案',
  '引用与归因',
  '抓取、收录与推荐边界',
  '机器可读入口'
]) {
  assert(llms.includes(heading), `llms.txt is missing the manual section: ${heading}`);
}
const llmsUrls = [...llms.matchAll(/https:\/\/www\.lxue\.xin\/[^\s)`]*/g)].map((match) => match[0]);
assert(new Set(llmsUrls).size <= 9, 'llms.txt should remain a manual, not a URL inventory');
assert(!fs.existsSync(path.join(root, 'urls.txt')), 'The redundant urls.txt file must stay removed');

const htaccess = read('.htaccess');
assert(
  !/ErrorDocument\s+404\s+\/index\.html/i.test(htaccess),
  'Missing URLs must not serve the homepage as a soft-404 document'
);

const edge = JSON.parse(read('edgeone.json'));
const redirects = new Map(edge.redirects.map((rule) => [rule.source, rule]));
const rewrites = new Map(edge.rewrites.map((rule) => [rule.source, rule]));
assert.equal(redirects.get('/articles/:slug.html')?.destination, '/articles/:slug');
assert.equal(redirects.get('/blog/index.html')?.destination, '/blog/');
for (const loc of articleSitemap.keys()) {
  const cleanPath = new URL(loc).pathname;
  const legacyRule = redirects.get(`${cleanPath}.html`);
  assert.equal(legacyRule?.destination, cleanPath, `${cleanPath}.html needs an explicit EdgeOne redirect`);
  assert.equal(legacyRule?.statusCode, 301, `${cleanPath}.html must redirect permanently`);
}
assert.equal(rewrites.get('/articles/:slug')?.destination, '/articles/:slug.html');
for (const [file, cleanPath] of corePages) {
  if (file === 'index.html') {
    assert.equal(redirects.get('/index.html')?.destination, '/');
    continue;
  }
  if (file === 'blog/index.html') {
    assert.equal(redirects.get('/blog.html')?.destination, '/blog/');
    continue;
  }
  assert.equal(redirects.get(`/${file}`)?.destination, cleanPath);
  assert.equal(rewrites.get(cleanPath)?.destination, `/${file}`);
}

console.log(
  `GEO/SEO architecture passed: ${coreSitemap.size} core URLs, ` +
  `${articleSitemap.size} article URLs, 39 canonical pages, two linked sitemaps.`
);
