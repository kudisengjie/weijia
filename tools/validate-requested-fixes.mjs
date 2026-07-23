import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const css = read('style.css');
const index = read('index.html');
const profile = read('profile.html');
const support = read('support.html');
const script = read('script.js');
const robots = read('robots.txt');
const llms = read('llms.txt');
const edgeone = JSON.parse(read('edgeone.json'));

for (const file of ['style.css', 'script.js', 'support.html', 'robots.txt', 'llms.txt', 'sitemap.xml']) {
  assert(!read(file).includes('\uFFFD'), `${file} should not contain replacement characters.`);
}

const requiredTitle = '<title>零雪AI|GEO服务商|GEO优化|GEO实战培训|AI推荐</title>';
assert(index.includes(requiredTitle), 'home page should use the approved browser title.');
assert(profile.includes(requiredTitle), 'brand detail page should use the approved browser title.');
assert(/class="logo"[^>]*>[\s\S]*?class="brand-name"[^>]*>零雪AI-Genesis<\/span>/.test(index), 'home logo should preserve the Genesis suffix.');
assert(/\.brand-name\s*\{[^}]*color:\s*#1e3a5f/s.test(css), 'brand name should use the site deep blue.');
assert(!/\.brand-name\s*\{[^}]*background(?:-image)?:\s*linear-gradient/s.test(css), 'brand name should not use a gradient.');
assert(/\.logo\s*\{[^}]*align-items:\s*center/s.test(css), 'logo icon and text should be vertically centered.');
assert(index.includes('>品牌详情</a>'), 'home navigation should use 品牌详情.');

const platformLogos = [
  ['images/platform-deepseek.png', 'DeepSeek'],
  ['images/platform-wenxin.png', '文心一言'],
  ['images/platform-qwen.png', '通义千问'],
  ['images/platform-yuanbao.png', '腾讯元宝'],
  ['images/platform-doubao.png', '豆包']
];
assert(index.includes('class="ai-platform-strip"'), 'home page should include the approved static AI platform strip.');
assert(index.includes('适配主流AI问答平台'), 'AI platform strip should expose a visible semantic heading.');
for (const [src, name] of platformLogos) {
  assert(exists(src), `${src} should exist.`);
  assert(index.includes(`src="${src}"`), `home page should use ${src}.`);
  assert(new RegExp(`<img[^>]+src="${src}"[^>]+alt="[^"]*${name}[^"]*"`).test(index), `${src} should expose a descriptive alt containing ${name}.`);
}
const platformCss = css.match(/\/\* AI platform strip[\s\S]*?\/\* End AI platform strip \*\//)?.[0] || '';
assert(platformCss, 'CSS should include a bounded AI platform strip component block.');
assert(!/\banimation(?:-name)?:/.test(platformCss), 'AI platform strip must not use automatic or looping animation.');
assert(!/@keyframes/.test(platformCss), 'AI platform strip must not define keyframe animation.');
assert(/\.ai-platform-item:hover/.test(platformCss), 'AI platform items may respond only to explicit hover interaction.');
assert(/\.ai-platform-item:focus-visible/.test(platformCss), 'AI platform items should expose a keyboard focus state.');

const blog = read('blog/index.html');
assert(blog.includes('class="recent-section-icon"'), 'blog recent heading should use the approved compact icon.');
assert(blog.includes('class="recent-item-arrow"'), 'blog recent rows should expose a user-triggered arrow affordance.');
const recentCss = css.match(/\/\* Recent article visual polish[\s\S]*?\/\* End recent article visual polish \*\//)?.[0] || '';
assert(recentCss, 'CSS should include a bounded recent article visual polish block.');
assert(!/\banimation(?:-name)?:/.test(recentCss), 'recent article visual polish must not use automatic animation.');
assert(/\.recent-article-item:hover/.test(recentCss), 'recent article rows should respond to explicit hover interaction.');
assert(/\.recent-article-item:focus-visible/.test(recentCss), 'recent article rows should expose a keyboard focus state.');
const buttonCss = css.match(/\/\* CTA button polish[\s\S]*?\/\* End CTA button polish \*\//)?.[0] || '';
assert(buttonCss, 'CSS should include the approved CTA button polish block.');
assert(!/\banimation(?:-name)?:/.test(buttonCss), 'CTA button polish must not use automatic animation.');
assert(/\.btn\.primary:hover/.test(buttonCss) && /\.btn\.secondary:hover/.test(buttonCss), 'primary and secondary CTAs should expose hover feedback.');
assert(/\.btn:focus-visible/.test(buttonCss), 'CTA buttons should expose a keyboard focus state.');

assert(profile.includes('data-brand-carousel'), 'brand detail page should include the approved carousel.');
const slideTitles = [
  'AI搜索语义网络与品牌可见度',
  '零雪AI GEO优化与AI营销工作台',
  'AI搜索到品牌推荐的GEO商业闭环',
  '传统搜索向生成式AI搜索的转型',
  '企业品牌智能与AI推荐系统'
];
assert.equal((profile.match(/class="brand-carousel__slide/g) || []).length, 5, 'brand carousel should contain exactly five slides.');
assert(profile.includes('data-i18n="profile.identity.h3">零雪AI详情介绍</h3>'), 'brand detail heading should use 零雪AI详情介绍.');
const carouselImages = [...profile.matchAll(/<img[^>]+class="brand-carousel__image"[^>]+alt="([^"]+)"/g)];
assert.equal(carouselImages.length, 5, 'all five carousel images should use the shared image class and expose alt text.');
for (const match of carouselImages) {
  assert(match[1].trim().length >= 18, 'carousel alt should be descriptive: ' + match[1]);
}
const profileJson = JSON.parse(profile.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/)[1]);
const profileGraph = Array.isArray(profileJson['@graph']) ? profileJson['@graph'] : [profileJson];
const profileImageObjects = profileGraph.filter((entry) => entry['@type'] === 'ImageObject');
assert.equal(profileImageObjects.length, 5, 'profile schema should expose all five carousel images as ImageObject.');
for (const image of profileImageObjects) {
  assert(image.contentUrl && image.caption && image.description, 'each carousel ImageObject needs contentUrl, caption and description.');
}
for (const title of slideTitles) {
  assert(profile.includes(title), `brand carousel should expose visible semantic title: ${title}`);
}
assert(/brand-carousel__slide is-active[\s\S]*?<img[^>]*fetchpriority="high"[^>]*loading="eager"/.test(profile), 'first carousel image should be eager and high priority.');
assert.equal((profile.match(/loading="lazy"/g) || []).length >= 4, true, 'non-first carousel images should be lazy loaded.');
assert(profile.includes('aria-label="上一张图片"') && profile.includes('aria-label="下一张图片"'), 'carousel should expose accessible previous/next controls.');
assert(profile.includes('brand-carousel__dots'), 'carousel should expose dot navigation.');
assert(script.includes('initBrandCarousel'), 'site script should initialize the brand carousel.');
assert(css.includes('@media (prefers-reduced-motion: reduce)'), 'site interactions should respect reduced-motion preference.');
assert(!script.includes('window.setInterval'), 'brand carousel should be manual and must not auto-advance.');
assert(!/\banimation\s*:[^;{}]*\binfinite\b/.test(css), 'site CSS should not contain continuous automatic animation.');
assert(/\.brand-carousel__caption\s*\{[^}]*opacity:\s*0\.[45-8]/s.test(css), 'carousel text should be dim by default.');
assert(/\.brand-carousel__caption:hover[\s\S]*opacity:\s*1/s.test(css), 'carousel text should become clear when the pointer reaches the text.');
assert(/@media\s*\(hover:\s*none\)[\s\S]*\.brand-carousel__caption\s*\{[^}]*opacity:\s*1/s.test(css), 'touch devices should keep carousel text readable.');
assert(/\.brand-carousel__caption h1,[\s\S]*?font-size:\s*clamp\(1\.1[0-9]rem,\s*2vw,\s*1\.8[0-9]rem\)/s.test(css), 'carousel headline should be smaller and image-first.');
assert(!css.includes('rgba(0, 6, 16, 0.84)'), 'carousel should not retain the heavy full-image overlay.');
assert(css.includes('--brand-detail-max: 1480px;'), 'carousel and brand detail modules should share a width token.');
assert(/\.brand-carousel__viewport,[\s\S]*\.profile-section \.container[\s\S]*max-width:\s*var\(--brand-detail-max\)/s.test(css), 'carousel and brand detail modules should align to the same width.');
assert(/\.brand-carousel\s*\{[^}]*background:\s*transparent/s.test(css), 'carousel outer area should not render a rectangular background strip.');

assert(css.includes('min-height: min(75vh, calc(100vh - 72px));'), 'home hero should occupy about 3/4 of the viewport.');
assert(!/\.hero-container\s*\{[^}]*transform:\s*translateX/s.test(css), 'home hero content should not be offset horizontally.');
assert(!css.includes('aspect-ratio: 1 / 1'), 'home AI card should not crop longer English copy with a fixed square ratio.');
assert(!/\.hero \.ai-stats-card\s*\{[^}]*flex(?:-basis)?:\s*(?:0 0|[0-9])/s.test(css), 'home AI stats should not use a fixed flex height that clips labels.');
assert(/\.footer-links,\s*\.footer-contact,\s*\.footer-brand\s*\{[^}]*justify-self:\s*center/s.test(css), 'mobile footer columns should center the actual footer-links element.');
assert(/\.footer-links\s*\{[^}]*justify-self:\s*center/s.test(css), 'desktop footer should center the actual footer-links element.');
assert(css.includes('Compact visual scale refinement'), 'CSS should include the compact visual scale refinement block.');
assert(css.includes('--site-content-max: 1120px;'), 'desktop content should be narrowed to a calmer 1120px scale.');
assert(css.includes('--site-article-max: 860px;'), 'article/detail content should be narrowed to a calmer 860px scale.');
assert(css.includes('padding-top: 96px !important;'), 'inner pages should sit below the nav without filling the first viewport.');
assert(css.includes('max-width: 1120px;'), 'home hero should use a narrower centered desktop frame.');
assert(css.includes('max-width: 330px;'), 'home AI demo should be reduced from the previous oversized desktop width.');
assert(css.includes('min-height: 360px;'), 'home AI card should be reduced from the previous oversized desktop height.');
assert(index.includes('<span class="hero-highlight">AIGE</span>'), 'home hero highlight should use AIGE.');
assert(!index.includes('AIGC'), 'home hero should not contain AIGC.');
assert(css.includes('Footer center alignment correction'), 'CSS should include the footer center alignment correction block.');
assert(css.includes('.support-section .recent-articles-section { margin-bottom: 0; }'), 'FAQ recent articles should not leave a large blank gap before the footer.');
assert(/\.footer-inner\s*\{[^}]*grid-template-columns:\s*minmax\(220px, 1fr\) auto minmax\(260px, 1fr\);[^}]*place-items:\s*center;[^}]*padding:\s*0;[^}]*min-height:\s*78px;/s.test(css), 'desktop footer inner grid should be centered without extra padding or oversized height.');

const supportRecentHrefs = [...support.matchAll(/<a class="recent-article-item" href="([^"]+)"/g)].map((match) => match[1]);
assert.equal(supportRecentHrefs.length, 12, 'FAQ page should expose the 12 recent article links.');
for (const href of supportRecentHrefs) {
  assert(href.includes('?from=faq'), `${href} should preserve FAQ source for breadcrumbs.`);
}
assert(script.includes('updateArticleBreadcrumbSource'), 'article pages should update breadcrumbs when opened from FAQ recent articles.');

const htmlFiles = [];
function collectHtmlFiles(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.worktrees' || entry.name === 'node_modules' || entry.name === 'artifacts') continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) collectHtmlFiles(rel);
    else if (entry.name.endsWith('.html')) htmlFiles.push(rel);
  }
}
collectHtmlFiles('');
for (const file of htmlFiles) {
  const html = read(file);
  if (html.includes('noindex')) continue;
  assert(html.includes('https://schema.org'), `tools/validate-requested-fixes.mjs should include schema.org JSON-LD.`);
}

const articleFiles = fs.readdirSync(path.join(root, 'articles')).filter((file) => file.endsWith('.html'));
for (const file of articleFiles) {
  const html = read(path.join('articles', file));
  assert(html.includes('BreadcrumbList'), `articles/tools/validate-requested-fixes.mjs should include BreadcrumbList schema.`);
}

const sitemapFiles = fs.readdirSync(root).filter((file) => /^sitemap.*\.xml$/.test(file)).sort();
assert.deepEqual(sitemapFiles, ['sitemap-articles.xml', 'sitemap.xml'], 'root should expose only sitemap.xml and sitemap-articles.xml.');

const mainSitemap = read('sitemap.xml');
const articleSitemap = read('sitemap-articles.xml');
const getLocs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const mainSitemapUrls = getLocs(mainSitemap);
const articleSitemapUrls = getLocs(articleSitemap);
assert(llms.includes('https://www.lxue.xin/articles/doubao-byte-geo-indexing-strategy.html'), 'llms.txt should expose the Doubao indexing strategy page.');
assert.equal((robots.match(/^User-agent:/gm) || []).length, 1, 'robots.txt should use one non-conflicting crawler rule group.');
assert(robots.includes('User-agent: *') && robots.includes('Allow: /'), 'robots.txt should allow general and AI crawlers.');
assert(robots.includes('Disallow: /admin/') && robots.includes('Disallow: /crawler-console.html'), 'robots.txt should keep private surfaces out of crawl traffic.');
const llmsSiteUrls = [...llms.matchAll(/https:\/\/www\.lxue\.xin\/[^\s，。)]+/g)].map((match) => match[0].replace(/[：:;,]+$/, ''));
assert.equal(new Set(llmsSiteUrls).size, llmsSiteUrls.length, 'llms.txt should not repeat the same canonical site URL.');
assert(llms.indexOf('## 近期文章（优先抓取）') < llms.indexOf('## 核心页面'), 'llms.txt should put recent articles before general core pages.');

assert.equal(mainSitemapUrls.filter((url) => url.includes('/articles/')).length, 0, 'main sitemap should not include article URLs.');
assert.deepEqual(mainSitemapUrls, [
  'https://www.lxue.xin/',
  'https://www.lxue.xin/profile.html',
  'https://www.lxue.xin/brand-facts.html',
  'https://www.lxue.xin/blog/',
  'https://www.lxue.xin/geo-guide.html',
  'https://www.lxue.xin/insights.html',
  'https://www.lxue.xin/support.html'
], 'main sitemap should contain only the primary pages.');

assert.equal(articleSitemapUrls.length, 28, 'article sitemap should contain all 23 existing and 5 new article URLs.');
assert(articleSitemapUrls.every((url) => url.startsWith('https://www.lxue.xin/articles/')), 'article sitemap should contain only article URLs.');
assert(articleSitemapUrls.some((url) => url.includes('doubao-byte-geo-indexing-strategy.html')), 'article sitemap should include the Doubao indexing strategy page.');
const submittedUrls = read('urls.txt').split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('https://www.lxue.xin/'));
assert.deepEqual(new Set([...mainSitemapUrls, ...articleSitemapUrls]), new Set(submittedUrls), 'urls.txt should exactly match the union of both sitemaps.');

for (const sitemap of ['sitemap.xml', 'sitemap-articles.xml']) {
  assert(exists(sitemap), sitemap + ' should exist.');
  assert(robots.includes('Sitemap: https://www.lxue.xin/' + sitemap), 'robots.txt should expose ' + sitemap + '.');
  assert(llms.includes('https://www.lxue.xin/' + sitemap), 'llms.txt should expose ' + sitemap + '.');
  const headerRule = edgeone.headers.find((entry) => entry.source === '/' + sitemap);
  assert(headerRule, 'edgeone.json should declare headers for ' + sitemap + '.');
  assert(headerRule.headers.some((header) => header.key === 'Content-Type' && header.value === 'application/xml; charset=UTF-8'), sitemap + ' should be served as UTF-8 XML.');
}

for (const removedSitemap of ['sitemap-pages.xml', 'sitemap-ai.xml', 'sitemap-index.xml']) {
  assert(!exists(removedSitemap), removedSitemap + ' should be removed.');
  assert(!robots.includes(removedSitemap), 'robots.txt should not reference ' + removedSitemap + '.');
  assert(!llms.includes(removedSitemap), 'llms.txt should not reference ' + removedSitemap + '.');
  assert(!edgeone.headers.some((entry) => entry.source === '/' + removedSitemap), 'edgeone.json should not declare headers for ' + removedSitemap + '.');
}

const decodeHtml = (value) => value
  .replaceAll('&mdash;', '—')
  .replaceAll('&ldquo;', '“')
  .replaceAll('&rdquo;', '”')
  .replaceAll('&amp;', '&')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replace(/\s+/g, ' ')
  .trim();
const publicHtmlFiles = [
  ...fs.readdirSync(root).filter((file) => file.endsWith('.html')),
  ...fs.readdirSync(path.join(root, 'articles')).filter((file) => file.endsWith('.html')).map((file) => `articles/${file}`),
  'blog/index.html',
];
const indexableCanonicals = [];
for (const file of publicHtmlFiles) {
  const html = read(file);
  if (/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html)) continue;
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '';
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1]?.trim() || '';
  const canonical = html.match(/<link\s+rel="canonical"\s+href="(https:\/\/www\.lxue\.xin\/[^"]*)"/i)?.[1] || '';
  assert(title.length >= 10 && title.length <= 65, `${file} title should be descriptive without truncation risk.`);
  assert(description.length >= 20 && description.length <= 160, `${file} meta description should summarize the page, not only show a date.`);
  assert(canonical, `${file} should expose a canonical URL.`);
  indexableCanonicals.push(canonical);
  assert.equal((html.match(/<h1\b/gi) || []).length, 1, `${file} should expose exactly one H1.`);
  for (const image of html.match(/<img\b[^>]*>/gi) || []) {
    assert(/\salt="[^"]*"/i.test(image), `${file} image should explicitly declare alt text.`);
    assert(/\swidth="\d+"/i.test(image) && /\sheight="\d+"/i.test(image), `${file} image should declare intrinsic width and height to reduce CLS: ${image}`);
  }
  const keywordContent = html.match(/<meta\s+name="keywords"\s+content="([^"]*)"/i)?.[1] || '';
  const keywordList = keywordContent.split(',').map((item) => item.trim()).filter(Boolean);
  assert.equal(new Set(keywordList).size, keywordList.length, `${file} meta keywords should not contain duplicates.`);
  const visibleText = decodeHtml(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
  const jsonLdBlocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)];
  assert(jsonLdBlocks.length > 0, `${file} should expose JSON-LD.`);
  for (const match of jsonLdBlocks) {
    const json = JSON.parse(match[1]);
    assert.equal(json['@context'], 'https://schema.org', `${file} JSON-LD should use the canonical schema.org context.`);
    const graph = Array.isArray(json['@graph']) ? json['@graph'] : [json];
    for (const entry of graph) {
      const types = Array.isArray(entry['@type']) ? entry['@type'] : [entry['@type']];
      if (types.includes('Article') || types.includes('BlogPosting')) {
        assert(entry.headline && entry.author && entry.publisher && entry.datePublished && entry.dateModified && entry.mainEntityOfPage, `${file} Article schema should expose headline, author, publisher, dates and mainEntityOfPage.`);
      }
      const questions = types.includes('FAQPage')
        ? entry.mainEntity || []
        : types.includes('Question')
          ? [entry]
          : entry.mainEntity?.['@type'] === 'Question'
            ? [entry.mainEntity]
            : [];
      for (const question of questions) {
        const name = decodeHtml(question.name || '');
        const answer = decodeHtml(question.acceptedAnswer?.text || '');
        assert(name && answer, `${file} Question schema should include a name and accepted answer.`);
        const finalCodePoint = name.codePointAt(name.length - 1);
        assert(finalCodePoint === 0x3f || finalCodePoint === 0xff1f, `${file} schema question should be visibly marked as a question: ${name}`);
        assert(visibleText.includes(name), `${file} schema question should match visible text: ${name}`);
        assert(visibleText.includes(answer), `${file} schema answer should match visible text: ${name}`);
      }
    }
  }
}
const sitemapUnion = [...mainSitemapUrls, ...articleSitemapUrls];
assert.deepEqual(new Set(indexableCanonicals), new Set(sitemapUnion), 'sitemaps should exactly cover all indexable canonical pages.');
assert.equal(new Set(indexableCanonicals).size, indexableCanonicals.length, 'indexable pages should not share duplicate canonical URLs.');
for (const canonical of indexableCanonicals) {
  assert(llms.includes(canonical), `llms.txt should expose indexable canonical URL ${canonical}.`);
}
for (const sitemapText of [mainSitemap, articleSitemap]) {
  for (const match of sitemapText.matchAll(/<url>[\s\S]*?<lastmod>([^<]+)<\/lastmod>[\s\S]*?<priority>([^<]+)<\/priority>[\s\S]*?<\/url>/g)) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(match[1]) && match[1] <= '2026-07-23', `sitemap lastmod should be a real, non-future date: ${match[1]}`);
    const priority = Number(match[2]);
    assert(Number.isFinite(priority) && priority >= 0 && priority <= 1, `sitemap priority should be between 0 and 1: ${match[2]}`);
  }
}
for (const slug of ['travel-industry-geo-service-provider', 'automotive-industry-geo-service-provider', 'lip-balm-geo-service-provider', 'skincare-geo-service-provider', 'furniture-industry-geo-service-provider']) {
  assert(new RegExp(`<loc>https://www\\.lxue\\.xin/articles/${slug}\\.html</loc>[\\s\\S]*?<priority>1\\.0</priority>`).test(articleSitemap), `${slug} should keep sitemap priority 1.0.`);
}
console.log('Requested fixes validation passed.');
