import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex').toUpperCase();

const css = read('style.css');
const index = read('index.html');
const profile = read('profile.html');
const support = read('support.html');
const script = read('script.js');
const i18n = read('i18n.js');
const robots = read('robots.txt');
const llms = read('llms.txt');
const edgeone = JSON.parse(read('edgeone.json'));

for (const file of ['style.css', 'script.js', 'support.html', 'robots.txt', 'llms.txt', 'sitemap.xml']) {
  assert(!read(file).includes('\uFFFD'), `${file} should not contain replacement characters.`);
}

const requiredTitle = '<title>零雪AI|GEO服务商|GEO优化|GEO实战培训|AI推荐</title>';
assert(!/<(?:time|strong)\\b/i.test(i18n), 'i18n values should remain plain text because the translator uses textContent.');
assert(index.includes(requiredTitle), 'home page should use the approved browser title.');
assert(profile.includes(requiredTitle), 'brand detail page should use the approved browser title.');
assert(/class="logo"[^>]*>[\s\S]*?class="brand-name"[^>]*>零雪AI-Genesis<\/span>/.test(index), 'home logo should preserve the Genesis suffix.');
assert(/\.brand-name\s*\{[^}]*color:\s*#1e3a5f/s.test(css), 'brand name should use the site deep blue.');
assert(!/\.brand-name\s*\{[^}]*background(?:-image)?:\s*linear-gradient/s.test(css), 'brand name should not use a gradient.');
assert(/\.logo\s*\{[^}]*align-items:\s*center/s.test(css), 'logo icon and text should be vertically centered.');
assert(index.includes('>品牌详情</a>'), 'home navigation should use 品牌详情.');
const logoPng = fs.readFileSync(path.join(root, 'images/logo.png'));
assert.notEqual(sha256('images/logo.png'), 'ABA365A13D75587FAEF13D1451F7FC51156E8115CCE903D1912C2E2B83AC1BC9', 'header logo must not use the retired green asset.');
assert.notEqual(sha256('favicon.ico'), 'EF00BACC614484B86171D68858C1BDD34CD43914EE8987C0A285EA01DD911462', 'favicon must not use the retired green asset.');
assert.equal(logoPng.toString('ascii', 1, 4), 'PNG', 'header logo should remain a PNG.');
assert.equal(logoPng.readUInt32BE(16), 256, 'header logo should use a proportionally fitted 256px canvas.');
assert.equal(logoPng.readUInt32BE(20), 256, 'header logo should use a proportionally fitted 256px canvas.');
assert([4, 6].includes(logoPng[25]), 'header logo should retain transparency.');
assert(index.includes('<link rel="apple-touch-icon" href="images/logo.png">'), 'home page should use the replacement logo for touch icons.');
assert(fs.statSync(path.join(root, 'favicon.ico')).size > 2000, 'favicon should be regenerated from the replacement logo at multiple sizes.');
assert(css.includes("url('images/logo.png?v=20260729')"), 'header logo URL should be versioned to invalidate retired immutable browser caches.');
assert(i18n.includes("'card.about.value2': 'Queries'"), 'English translation should cover the visible capability value.');
assert(i18n.includes("'card.about.stat2': 'Platform Query Retesting'"), 'English translation should preserve the platform-query retest meaning.');

const platformLogos = [
  ['images/platform-deepseek.png', 'DeepSeek'],
  ['images/platform-kimi.png', 'Kimi'],
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
assert.equal((index.match(/class="ai-platform-item"/g) || []).length, 6, 'home page should expose exactly six AI platform entry cards.');
const platformArticleRoutes = {
  doubao: 'doubao-byte-geo-indexing-strategy',
  deepseek: 'deepseek-geo-evidence-density-strategy',
  yuanbao: 'yuanbao-geo-ecosystem-guide',
  qwen: 'qwen-geo-ecosystem-guide',
  wenxin: 'wenxin-geo-ecosystem-guide',
  kimi: 'kimi-geo-ecosystem-guide'
};
for (const [platform, slug] of Object.entries(platformArticleRoutes)) {
  assert(index.includes(`href="/articles/${slug}"`), `home ${platform} card should enter its independent article.`);
  assert(profile.includes(`id="platform-${platform}"`), `brand detail should expose a stable ${platform} topic anchor.`);
  assert(profile.includes(`href="/articles/${slug}"`), `brand detail ${platform} card should enter its independent article.`);
}
assert.equal((index.match(/class="ai-platform-item"[^>]+target="_blank"/g) || []).length, 0, 'home platform cards should remain internal links.');
assert(!index.includes('ai-platform-item--primary'), 'home platform cards should not expose a primary state.');
assert(!index.includes('重点适配'), 'home platform cards should not display a priority label.');
assert(/\.ai-platform-list\s*\{[^}]*grid-template-columns:\s*repeat\(6,/s.test(platformCss), 'desktop platform strip should use a six-column grid.');
assert(!/\.ai-platform-item--primary\s*\{/.test(platformCss), 'platform strip should not retain a Doubao-only primary state.');

assert.equal((profile.match(/class="ai-platform-card"/g) || []).length, 6, 'brand detail page should expose six AI platform topic cards.');
for (const platform of ['doubao', 'deepseek', 'yuanbao', 'qwen', 'wenxin', 'kimi']) {
  assert(profile.includes(`data-i18n="profile.aiTopics.${platform}.title"`), `brand detail page should include the ${platform} topic title.`);
}
assert(!profile.includes('ai-platform-card--primary'), 'brand detail platform cards should use one consistent visual state.');
assert(!profile.includes('· 重点'), 'brand detail platform tags should not display a priority label.');
for (const [src, name] of platformLogos) {
  assert(new RegExp(`<a[^>]+class="ai-platform-card"[^>]*>[\\s\\S]*?<img[^>]+src="${src}"[^>]+alt="[^"]*${name}[^"]*"`).test(profile), `brand detail card should use the ${name} logo.`);
}
assert(profile.includes('src="images/lxue-ice-elf-wave-transparent.png"'), 'brand detail page should use the approved transparent ice-elf mascot.');
assert(exists('images/lxue-ice-elf-wave-transparent.png'), 'the approved transparent ice-elf mascot asset should exist.');
if (exists('images/lxue-ice-elf-wave-transparent.png')) {
  const png = fs.readFileSync(path.join(root, 'images/lxue-ice-elf-wave-transparent.png'));
  assert.equal(png.toString('ascii', 1, 4), 'PNG', 'approved transparent ice-elf mascot should be a valid PNG.');
  assert([4, 6].includes(png[25]), 'approved transparent ice-elf mascot PNG should include an alpha channel.');
}

const blog = read('blog/index.html');
assert(!blog.includes("'<h3") && !blog.includes("</h3>'"), 'blog recent heading should not render stray quote characters.');
assert(blog.includes('class="recent-section-icon"'), 'blog recent heading should use the approved compact icon.');
assert(blog.includes('class="recent-item-arrow"'), 'blog recent rows should expose a user-triggered arrow affordance.');
assert(support.includes('class="recent-section-icon"'), 'FAQ recent heading should use the same compact icon as the blog.');
assert.equal((support.match(/class="recent-item-arrow"/g) || []).length, 12, 'all 12 FAQ recent rows should use the shared arrow affordance.');
assert.equal((blog.match(/class="recent-article-item"/g) || []).length, 9, 'blog recent list should keep its nine existing articles.');
assert.equal((blog.match(/<time class="recent-date" datetime="2026-06-30">06-30<\/time>/g) || []).length, 9, 'blog recent dates should use the same semantic time element as the FAQ component.');
assert(!css.includes('radial-gradient(circle at 96% 12%'), 'recent article cards should not render decorative dot artifacts.');
assert(!css.includes('.recent-article-item:nth-child(-n+3) .recent-rank { background: #e60012; }'), 'recent article numbering should use one consistent blue style.');
const recentCss = css.match(/\/\* Recent article visual polish[\s\S]*?\/\* End recent article visual polish \*\//)?.[0] || '';
assert(recentCss, 'CSS should include a bounded recent article visual polish block.');
assert(!/\banimation(?:-name)?:/.test(recentCss), 'recent article visual polish must not use automatic animation.');
assert(/\.recent-article-item:hover/.test(recentCss), 'recent article rows should respond to explicit hover interaction.');
assert(/\.recent-article-item:focus-visible/.test(recentCss), 'recent article rows should expose a keyboard focus state.');
assert(/@media\s*\(max-width:\s*768px\)[\s\S]*\.recent-article-item\s*\{[^}]*grid-template-columns:\s*34px minmax\(0,\s*1fr\) auto/s.test(recentCss), 'recent articles should use a stable mobile grid.');
assert(/@media\s*\(max-width:\s*768px\)[\s\S]*\.recent-item-arrow\s*\{[^}]*display:\s*none/s.test(recentCss), 'mobile recent rows should hide the optional arrow to preserve title space.');
const buttonCss = css.match(/\/\* CTA button polish[\s\S]*?\/\* End CTA button polish \*\//)?.[0] || '';
assert(buttonCss, 'CSS should include the approved CTA button polish block.');
assert(!/\banimation(?:-name)?:/.test(buttonCss), 'CTA button polish must not use automatic animation.');
assert(/\.btn\.primary:hover/.test(buttonCss) && /\.btn\.secondary:hover/.test(buttonCss), 'primary and secondary CTAs should expose hover feedback.');
assert(/\.btn:focus-visible/.test(buttonCss), 'CTA buttons should expose a keyboard focus state.');
const blogRailCss = css.match(/\/\* Blog reading rail alignment[\s\S]*?\/\* End blog reading rail alignment \*\//)?.[0] || '';
assert(blogRailCss, 'CSS should include a bounded blog reading rail alignment block.');
assert(/\.blog-section > \.container\s*\{[^}]*width:\s*min\(1120px,/s.test(blogRailCss), 'industry blog should use one centered 1120px outer rail.');
assert(/--blog-reading-rail:\s*900px/.test(blogRailCss), 'industry blog should use a centered 900px reading rail.');
assert(/@media\s*\(max-width:\s*768px\)/.test(blogRailCss), 'blog reading rail should include an explicit mobile layout.');

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

assert(!/8\.2亿|380%|57%|15%-25%/.test(support), 'FAQ content and Schema should not retain unsupported market or performance claims.');
assert(support.includes('<h1 class="page-title" data-i18n="faq.h2">AI问答</h1>'), 'support page should use the approved concise AI问答 heading.');
assert(/class="[^"]*answer-center-hero[^"]*"/.test(support), 'AI search Q&A center should start with a direct-answer evidence hero.');
assert(!support.includes('doubao.com/legal/terms'), 'Q&A center must not cite the Doubao user agreement.');
assert(!support.includes('豆包官方用户协议'), 'Q&A center must not refer to the Doubao user agreement.');
assert(support.includes('复测口径'), 'Q&A center should explain its reproducible evidence method.');
assert(!/1,236|56家|108份|3年行业经验/.test(index), 'home brand card should not expose unverified volume metrics.');
for (const capability of ['品牌事实治理', '平台问句复测', '结构化内容', '信源与时效审计']) {
  assert(index.includes(capability), `home brand card should replace weak metrics with verifiable capability: ${capability}`);
}
assert(/\.recent-item-arrow\s*\{[^}]*align-self:\s*center/s.test(css), 'recent row arrows should align vertically to the row center.');
for (const label of ['GEO策略', 'AI问答']) {
  assert(index.includes(`>${label}</a>`), `home navigation should expose ${label}.`);
}
assert(!index.includes('GEO策略中心') && !index.includes('AI问答中心'), 'home should not retain the retired center suffixes.');
assert(!/不足20%|68%以上|1-3个月内可见|已被明确定性为违法|正在取代传统搜索|首部GEO行业技术规范/.test(support), 'Q&A center should not retain unverified fixed rules, performance promises or industry-first claims.');
const supportRecentHrefs = [...support.matchAll(/<a class="recent-article-item" href="([^"]+)"/g)].map((match) => match[1]);
assert.equal(supportRecentHrefs.length, 12, 'FAQ page should expose the 12 recent article links.');
for (const href of supportRecentHrefs) {
  assert(href.includes('?from=faq'), `${href} should preserve FAQ source for breadcrumbs.`);
}
assert(script.includes('updateArticleBreadcrumbSource'), 'article pages should update breadcrumbs when opened from FAQ recent articles.');

const platformArticles = [
  'doubao-byte-geo-indexing-strategy.html',
  'deepseek-geo-evidence-density-strategy.html',
  'yuanbao-geo-ecosystem-guide.html',
  'qwen-geo-ecosystem-guide.html',
  'wenxin-geo-ecosystem-guide.html',
  'kimi-geo-ecosystem-guide.html'
];
const countCjk = (text) => [...text].filter((char) => {
  const code = char.codePointAt(0);
  return (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff);
}).length;
for (const file of platformArticles) {
  const html = read(path.join('articles', file));
  const article = html.match(/<article[\s\S]*?<\/article>/)?.[0] || '';
  const visible = article
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  assert(countCjk(visible) >= 1800, `${file} should contain at least 1800 visible Chinese characters.`);
  assert((article.match(/<h2\b/g) || []).length >= 8, `${file} should use at least eight clear H2 sections.`);
  assert(article.includes('article-key-takeaways'), `${file} should include a scannable key-takeaways block.`);
  assert(html.includes('"dateModified": "2026-07-26"'), `${file} schema should carry the current modification date.`);
}

const insights = read('insights.html');
for (const platform of ['元宝 / 腾讯生态', '豆包 / 字节生态', 'DeepSeek', '文心一言 / 百度生态', '通义千问 / 阿里生态', 'Kimi / 长文本问答']) {
  assert(insights.includes(platform), `GEO strategy should cover ${platform}.`);
}

assert(blog.includes('2026年7月26日更新'), 'industry blog should expose a visible freshness date.');
assert(blog.includes('\u0032\u0030\u0032\u0036\u5e74\u0037\u6708GEO\u5185\u5bb9\u6cbb\u7406\uff1a\u6280\u672f\u5e95\u5ea7\u3001\u53ef\u4fe1\u6765\u6e90\u4e0e\u6301\u7eed\u66f4\u65b0'), 'industry blog should retain its current governance article after the audit banner is removed.');
assert(!/286亿|942亿|8\.2亿|380%|57%|额外加权20%|降权30-50%/.test(blog), 'industry blog should not retain unsupported or stale performance claims.');
const guide = read('geo-guide.html');
assert(guide.includes('GEO\u4f18\u5316\u6307\u5357'), 'GEO guide should retain its primary semantic heading.');
assert(guide.includes('\u5e38\u89c4\u5185\u5bb9\u6838\u9a8c\u7a97\u53e3'), 'GEO guide should explain its review cadence without the removed top banner.');
assert(!/220亿美元|122%|8\.2亿|380%|57%|15%-25%|3倍以上/.test(guide), 'GEO guide should not retain unsupported or stale market and performance claims.');
for (const html of [blog, guide]) {
  const json = JSON.parse(html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/)[1]);
  const graph = Array.isArray(json['@graph']) ? json['@graph'] : [json];
  const dated = graph.filter((entry) => ['Article', 'TechArticle', 'BlogPosting', 'CollectionPage'].includes(entry['@type']));
  assert(dated.length > 0, 'updated editorial pages should expose dated Schema.org entities.');
  assert(dated.every((entry) => entry.dateModified === '2026-07-26'), 'updated editorial Schema.org entities should use the real 2026-07-26 modification date.');
}
assert(llms.includes('## 4. 内容类型与解释规则') && llms.includes('## 6. 问句与直接答案'), 'llms.txt should operate as a structured model-facing manual.');

const htmlFiles = [];
const isPublicHtmlName = (name) => name.endsWith('.html') && !name.startsWith('_');
function collectHtmlFiles(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.worktrees' || entry.name === '.superpowers' || entry.name === 'node_modules' || entry.name === 'artifacts') continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) collectHtmlFiles(rel);
    else if (isPublicHtmlName(entry.name)) htmlFiles.push(rel);
  }
}
collectHtmlFiles('');
for (const file of htmlFiles) {
  const html = read(file);
  if (html.includes('noindex')) continue;
  assert(html.includes('https://schema.org'), `tools/validate-requested-fixes.mjs should include schema.org JSON-LD.`);
  if (/(?:\.\.\/)*style\.css(?:["'])/.test(html)) {
    assert(/(?:\.\.\/)*style\.css\?v=20260812(?:["'])/.test(html), `${file} should version the shared stylesheet.`);
  }
  if (/(?:\.\.\/)*i18n\.js(?:["'])/.test(html)) {
    assert(/(?:\.\.\/)*i18n\.js\?v=20260729(?:["'])/.test(html), `${file} should version the translation bundle.`);
  }
  if (/(?:\.\.\/)*script\.js(?:["'])/.test(html)) {
    assert(/(?:\.\.\/)*script\.js\?v=20260729(?:["'])/.test(html), `${file} should version the shared interaction bundle.`);
  }
}

const i18nContext = {
  document: { addEventListener() {} },
  localStorage: { getItem() { return null; }, setItem() {} }
};
vm.createContext(i18nContext);
vm.runInContext(i18n, i18nContext);
const englishTranslations = i18nContext.i18n.translations.en;
for (const file of htmlFiles) {
  const html = read(file);
  if (/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html)) continue;
  for (const match of html.matchAll(/data-i18n(?:-placeholder|-aria)?="([^"]+)"/g)) {
    const key = match[1];
    assert(Object.hasOwn(englishTranslations, key), `${file} should provide an English translation for ${key}.`);
    if (!['nav.lang', 'footer.icp'].includes(key)) {
      assert(!/[\u3400-\u9fff]/.test(englishTranslations[key]), `${file} English translation should not retain Chinese text for ${key}.`);
    }
  }
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
assert.equal((robots.match(/^User-agent:/gm) || []).length, 1, 'robots.txt should use one non-conflicting crawler rule group.');
assert(robots.includes('User-agent: *') && robots.includes('Allow: /'), 'robots.txt should allow general and AI crawlers.');
assert(!robots.includes('/admin/') && !robots.includes('/crawler-console'), 'retired crawler admin routes must not remain in robots.txt.');
const llmsSiteUrls = [...llms.matchAll(/https:\/\/www\.lxue\.xin\/[^\s，。)]+/g)].map((match) => match[0].replace(/[：:;,]+$/, ''));
assert.equal(new Set(llmsSiteUrls).size, llmsSiteUrls.length, 'llms.txt should not repeat the same canonical site URL.');
assert(llmsSiteUrls.length <= 12, 'llms.txt should remain a concise manual rather than duplicating the sitemap URL inventory.');

assert.equal(mainSitemapUrls.filter((url) => url.includes('/articles/')).length, 0, 'main sitemap should not include article URLs.');
assert.deepEqual(mainSitemapUrls, [
  'https://www.lxue.xin/',
  'https://www.lxue.xin/profile',
  'https://www.lxue.xin/brand-facts',
  'https://www.lxue.xin/blog/',
  'https://www.lxue.xin/geo-guide',
  'https://www.lxue.xin/insights',
  'https://www.lxue.xin/support'
], 'main sitemap should contain only the primary pages.');

assert.equal(articleSitemapUrls.length, 32, 'article sitemap should contain the existing set plus four independent platform articles.');
assert(articleSitemapUrls.every((url) => url.startsWith('https://www.lxue.xin/articles/')), 'article sitemap should contain only article URLs.');
const platformOfficialUrls = {
  doubao: 'https://www.doubao.com/chat/',
  deepseek: 'https://chat.deepseek.com/',
  yuanbao: 'https://yuanbao.tencent.com/',
  qwen: 'https://www.qianwen.com/',
  wenxin: 'https://yiyan.baidu.com/',
  kimi: 'https://www.kimi.com/'
};
for (const [platform, slug] of Object.entries(platformArticleRoutes)) {
  const rel = `articles/${slug}.html`;
  const cleanRoute = `articles/${slug}`;
  const canonical = `https://www.lxue.xin/${cleanRoute}`;
  assert(exists(rel), `${rel} should exist.`);
  assert(articleSitemapUrls.includes(canonical), `article sitemap should include ${canonical}.`);
  const html = read(rel);
  const logo = platform === 'doubao' ? 'platform-doubao.png' : `platform-${platform}.png`;
  assert(html.includes(`class="platform-article-logo-link" href="${platformOfficialUrls[platform]}" target="_blank" rel="noopener noreferrer"`), `${rel} should link its logo safely to the official platform.`);
  assert(html.includes(`src="../images/${logo}"`), `${rel} should use its corresponding platform logo.`);
  assert(!html.includes('yirui-robot'), `${rel} should not use the generic robot in its platform callout.`);
  assert(!blog.includes(rel) && !blog.includes(cleanRoute), `${rel} should remain outside the industry blog recent-article list.`);
}
assert(!exists('urls.txt'), 'urls.txt should not duplicate the two canonical sitemap URL inventories.');
assert(edgeone.redirects.some((entry) => entry.source === '/urls.txt' && entry.destination === '/sitemap.xml'), 'legacy /urls.txt requests should redirect to the primary sitemap.');

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
  ...fs.readdirSync(root).filter(isPublicHtmlName),
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
      if (types.includes('Article') || types.includes('TechArticle') || types.includes('BlogPosting')) {
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
assert(llms.includes('https://www.lxue.xin/sitemap.xml') && llms.includes('https://www.lxue.xin/sitemap-articles.xml'), 'llms.txt should delegate URL discovery to both sitemaps.');
for (const sitemapText of [mainSitemap, articleSitemap]) {
  for (const match of sitemapText.matchAll(/<url>[\s\S]*?<lastmod>([^<]+)<\/lastmod>[\s\S]*?<priority>([^<]+)<\/priority>[\s\S]*?<\/url>/g)) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(match[1]) && match[1] <= '2026-07-29', `sitemap lastmod should be a real, non-future date: ${match[1]}`);
    const priority = Number(match[2]);
    assert(Number.isFinite(priority) && priority >= 0 && priority <= 1, `sitemap priority should be between 0 and 1: ${match[2]}`);
  }
}
for (const slug of ['travel-industry-geo-service-provider', 'automotive-industry-geo-service-provider', 'lip-balm-geo-service-provider', 'skincare-geo-service-provider', 'furniture-industry-geo-service-provider']) {
  assert(new RegExp(`<loc>https://www\\.lxue\\.xin/articles/${slug}</loc>[\\s\\S]*?<priority>1\\.0</priority>`).test(articleSitemap), `${slug} should keep sitemap priority 1.0.`);
}

const redesignPages = {
  'blog/index.html': read('blog/index.html'),
  'geo-guide.html': read('geo-guide.html'),
  'insights.html': read('insights.html')
};
const visibleCjkCount = (html) => {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || '';
  const main = (html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || body)
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ');
  const visible = main
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return (visible.match(/[\u3400-\u9fff]/g) || []).length;
};
for (const [file, html] of Object.entries(redesignPages)) {
  assert(visibleCjkCount(html) >= 1500, file + ' should expose at least 1500 visible Chinese characters.');
}
assert(!/["'][^"']+["']\s*:\s*["'][^"']*<[a-z][^>]*>/i.test(i18n), 'translation values must not embed HTML that is rendered as literal text.');
assert(!guide.includes('class="suitable-note" data-i18n="guide.value.suitable"'), 'the GEO suitability note should translate label and body separately.');
assert(!blog.includes('class="content-freshness'), 'the blog should not render the removed audit banner.');
assert(!blog.includes('class="blog-intro"'), 'the blog should not render the removed audit introduction card.');
assert(!guide.includes('class="content-freshness'), 'the GEO guide should not render the removed review banner.');
assert(!profile.includes('class="content-review-note'), 'brand detail should not render the removed review banner.');
assert(!read('insights.html').includes('class="content-review-note'), 'GEO strategy should not render the removed review banner.');
assert(!support.includes('answer-center-hero__evidence'), 'AI Q&A should not render the removed retest explanation.');
assert(!support.includes('page-support'), 'AI Q&A should use its established page and module styling.');
assert(blog.includes('data-i18n="blog.a4.th.yuanbao"'), 'the platform comparison should include Yuanbao.');
assert(!blog.includes('data-i18n="blog.a4.th.wenxin"'), 'the platform comparison should no longer include Wenxin.');
assert(/class="article-conclusion[^"]*centered-callout[^"]*"[\s\S]*?data-i18n="blog\.a4\.conclusion"/.test(blog), 'the fourth blog conclusion should use the shared centered layout.');
const expandedBenchmark = '时间线用于安排检查，不承诺固定收录或推荐结果。实际变化会受到网站基础、行业公开信息量、平台抓取节奏、内容质量与竞争环境影响；因此每个阶段都应保存测试问句、日期、答案与来源，再以连续记录判断趋势。';
assert(guide.includes('data-i18n="guide.benchmark.note">' + expandedBenchmark + '</p>'), 'the static GEO benchmark note should match the expanded Chinese translation.');
assert(css.includes('/* ===== Premium Blue Editorial System ===== */'), 'the shared premium blue editorial system should exist.');
assert(css.includes('--surface-blue-soft:'), 'the redesign should use a shared pale-blue surface token.');
assert(css.includes('.centered-callout'), 'short conclusion callouts should share a centered layout.');
assert(css.includes('.hero-premium-surface'), 'the home hero should use the shared premium blue-white surface.');
assert(/\.page-profile \.profile-onemorething\s*\{[^}]*background:\s*linear-gradient\([^}]*#1e3a5f/s.test(css), 'brand detail One More Thing should keep a readable deep-blue background.');
assert(/\.page-strategy \.deliver-card small\s*\{[^}]*display:\s*inline-flex[^}]*border-radius:\s*999px/s.test(css), 'strategy delivery labels should use proportional pill styling.');
assert(!css.includes('.page-profile .profile-content-block::before'), 'brand detail cards should keep only their original single left border.');
assert(/\.page-strategy \.strategy-lead\s*\{[^}]*max-width:\s*1400px[^}]*text-wrap:\s*balance/s.test(css), 'strategy lead copy should use a wider balanced line box to prevent orphan characters.');
for (const page of ['index.html', 'profile.html', 'blog/index.html', 'geo-guide.html', 'insights.html']) {
  const html = read(page);
  assert(html.includes('premium-page'), page + ' should opt into the shared premium page system.');
}

const englishBase = i18n.slice(i18n.indexOf('i18n.translations.en = {'), i18n.indexOf('Object.assign(i18n.translations.zh'));
const englishStrategy = i18n.slice(i18n.indexOf('Object.assign(i18n.translations.en, {'));
for (const phrase of [
  'Each review should record URL status, crawl date, visible body text, entity wording, and actual sources',
  'For acceptance, also confirm that the body is readable without interaction',
  'A qualified module should tell readers what the conclusion is, why it holds, when it applies, and how to verify the next step',
  'Every stage should therefore preserve the test question, date, answer, and cited source'
]) assert(englishBase.includes(phrase), 'English editorial expansion is missing: ' + phrase);
for (const phrase of [
  'Create a brand-facts register first',
  'Use fixed questions, one time window, and identical record fields',
  'Platform adaptation changes titles, summaries, Q&A, and presentation order without changing brand facts',
  'The monthly report should list new pages, revised facts, question coverage, incorrect answers, and qualified inquiries'
]) assert(englishStrategy.includes(phrase), 'English strategy expansion is missing: ' + phrase);

console.log('Requested fixes validation passed.');
