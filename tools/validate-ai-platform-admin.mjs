import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

const articleSlugs = [
  'doubao-byte-geo-indexing-strategy',
  'deepseek-geo-evidence-density-strategy',
  'yuanbao-geo-ecosystem-guide',
  'qwen-geo-ecosystem-guide',
  'wenxin-geo-ecosystem-guide',
  'kimi-geo-ecosystem-guide'
];

for (const relPath of [
  'admin/index.html',
  'admin/app.js',
  'admin/style.css',
  'admin/server.mjs',
  'admin/crawler-classifier.mjs',
  'crawler-console.html',
  'images/robot-login.png',
  'images/robot-neutral.png',
  'images/robot-doubao.png',
  'images/robot-deepseek.png'
]) {
  assert.ok(exists(relPath), `${relPath} should exist.`);
}

const profile = read('profile.html');
const script = read('script.js');
const consolePage = read('crawler-console.html');
const adminIndex = read('admin/index.html');
const adminApp = read('admin/app.js');
const adminStyle = read('admin/style.css');
assert.ok(profile.includes('ai-platform-topics'), 'profile.html should include the AI platform topics module.');
assert.ok(script.includes('crawler-console-entry'), 'script.js should inject the hidden crawler console entry.');
assert.ok(script.includes("'/admin/'"), 'script.js should link the hidden footer entry to the clean private admin route.');
assert.ok(consolePage.includes('src="/admin/"'), 'crawler-console.html should embed the clean private admin route.');
assert.ok(!consolePage.includes('src="admin/index.html"'), 'crawler-console.html must not expose the legacy admin index filename.');
assert.ok(consolePage.includes('http://localhost:8787/admin/'), 'crawler-console.html should redirect local file previews directly to the admin server.');
assert.ok(adminIndex.includes('../images/robot-login.png'), 'admin/index.html should use the clean login robot cutout.');
assert.ok(adminIndex.includes('admin-open-help'), 'admin/index.html should include local server help for login.');
assert.ok(!adminIndex.includes('value="13539770556"'), 'admin/index.html should not prefill the private account for other visitors.');
assert.ok(adminIndex.includes('autocomplete="off"'), 'admin/index.html should turn off credential autofill hints.');
assert.ok(adminIndex.includes('data-admin-lang-switch'), 'admin/index.html should expose a private admin language switch.');
assert.ok(adminIndex.includes('data-i18n="login.title"'), 'admin/index.html should mark login copy for translation.');
assert.ok(adminIndex.includes('data-i18n-placeholder="login.username.placeholder"'), 'admin/index.html should translate form placeholders.');
assert.ok(adminIndex.includes('data-i18n-aria="login.password.show"'), 'admin/index.html should translate password accessibility labels.');
assert.ok(adminStyle.includes('.admin-open-help { display: none;'), 'admin help should be hidden until the API is unavailable.');
assert.ok(/\.login-robot[\s\S]*z-index:\s*2/.test(adminStyle), 'admin/style.css should keep the robot above its stand.');
assert.ok(/\.robot-stand[\s\S]*z-index:\s*1/.test(adminStyle), 'admin/style.css should keep the stand below the robot.');
assert.ok(adminStyle.includes('word-break: keep-all'), 'admin/style.css should avoid awkward title wrapping.');
assert.ok(adminApp.includes('当前是静态文件预览'), 'admin/app.js should explain failed local file login.');
assert.ok(adminApp.includes('adminOpenHelp') && adminApp.includes("classList.add('visible')"), 'admin/app.js should reveal local help only on connection failure.');
assert.ok(adminApp.includes('window.setInterval(loadLogs, 60000)'), 'admin/app.js should auto-refresh live crawler data every 60 seconds.');
assert.ok(adminApp.includes("localStorage.getItem('lang')"), 'admin/app.js should share the public site language key.');
assert.ok(adminApp.includes('adminTranslations'), 'admin/app.js should define private admin translations.');
assert.ok(adminApp.includes('GEO Optimization Platform - Crawler Log Admin'), 'admin/app.js should include English login translations.');
assert.ok(adminApp.includes('AI Crawler Data Management'), 'admin/app.js should include English dashboard translations.');
assert.ok(adminApp.includes('applyLanguage'), 'admin/app.js should apply translations to the admin UI.');
assert.ok(adminApp.includes('&_=') && adminApp.includes('Date.now()'), 'admin/app.js should add a cache-busting timestamp for live log queries.');
assert.ok(adminApp.includes("'Cache-Control': 'no-cache'"), 'admin/app.js should send no-cache requests for log data.');
assert.ok(adminIndex.includes('lastRefreshText'), 'admin/index.html should show the last live refresh time.');
assert.ok(profile.includes('images/yirui-robot-wave-cutout.png'), 'profile.html should use the approved transparent waving robot cutout.');

for (const slug of articleSlugs) {
  const sourceFile = `articles/${slug}.html`;
  const cleanRoute = `/articles/${slug}`;
  assert.ok(profile.includes(`href="${cleanRoute}"`), `profile.html should link to ${cleanRoute}.`);
  const articleSitemap = read('sitemap-articles.xml');
  assert.ok(articleSitemap.includes(`https://www.lxue.xin${cleanRoute}`), `sitemap-articles.xml should include ${cleanRoute}.`);
  assert.ok(/User-agent:\s*\*[\s\S]*Allow:\s*\//.test(read('robots.txt')), 'robots.txt should allow public articles through its wildcard group.');

  const html = read(sourceFile);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${sourceFile} should have exactly one h1.`);
  assert.ok(html.includes(`https://www.lxue.xin${cleanRoute}`), `${sourceFile} should have a clean canonical absolute URL.`);
  assert.ok(html.includes('"@type": "Article"'), `${sourceFile} should include Article schema.`);
  assert.ok(html.includes('"@type": "BreadcrumbList"'), `${sourceFile} should include BreadcrumbList schema.`);
  assert.ok(html.includes('"@type": "FAQPage"'), `${sourceFile} should include FAQPage schema.`);
  assert.ok(html.includes('article-ai-pattern'), `${sourceFile} should include AI visual pattern styling hook.`);
  assert.ok(!html.includes('display:none') && !html.includes('visibility:hidden'), `${sourceFile} should not hide text from users.`);
}

const adminServer = read('admin/server.mjs');
for (const expected of [
  'HttpOnly',
  'ADMIN_PASSWORD_HASH',
  'TENCENT_CLS_TOPIC_ID',
  'SearchLog',
  'QueryString',
  'seconds * 1000',
  '/api/admin/crawler-logs'
]) {
  assert.ok(adminServer.includes(expected), `admin/server.mjs should include ${expected}.`);
}
const crawlerClassifier = read('admin/crawler-classifier.mjs');
assert.ok(crawlerClassifier.includes('LogTime'), 'crawler-classifier should normalize CLS LogTime fields.');
assert.ok(crawlerClassifier.includes('normalizeTime'), 'crawler-classifier should normalize second and millisecond timestamps.');

console.log('AI platform topic and admin surface validation passed.');
