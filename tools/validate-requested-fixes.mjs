import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const css = read('style.css');
const index = read('index.html');
const support = read('support.html');
const script = read('script.js');
const robots = read('robots.txt');
const llms = read('llms.txt');
const edgeone = JSON.parse(read('edgeone.json'));

for (const file of ['style.css', 'script.js', 'support.html', 'robots.txt', 'llms.txt', 'sitemap.xml']) {
  assert(!read(file).includes('\uFFFD'), `${file} should not contain replacement characters.`);
}

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
assert(index.includes('<span class="hero-highlight">AIGC</span>'), 'home hero highlight should use AIGC, not AIGE.');
assert(!index.includes('AIGE'), 'home hero should not contain the AIGE typo.');
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
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
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

for (const sitemap of ['sitemap-pages.xml', 'sitemap-articles.xml', 'sitemap-ai.xml', 'sitemap-index.xml']) {
  assert(exists(sitemap), `${sitemap} should exist.`);
  assert(robots.includes(`Sitemap: https://www.lxue.xin/${sitemap}`), `robots.txt should expose ${sitemap}.`);
  assert(llms.includes(`https://www.lxue.xin/${sitemap}`), `llms.txt should expose ${sitemap}.`);
  const headerRule = edgeone.headers.find((entry) => entry.source === `/${sitemap}`);
  assert(headerRule, `edgeone.json should declare headers for ${sitemap}.`);
  assert(headerRule.headers.some((header) => header.key === 'Content-Type' && header.value === 'application/xml; charset=UTF-8'), `${sitemap} should be served as UTF-8 XML.`);
}


console.log('Requested fixes validation passed.');
