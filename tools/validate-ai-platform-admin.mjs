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
  'deepseek-geo-evidence-density-strategy'
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
assert.ok(script.includes('admin/index.html'), 'script.js should link the hidden footer entry directly to the admin page.');
assert.ok(consolePage.includes('admin/index.html'), 'crawler-console.html should embed the concrete admin page, not a directory index.');
assert.ok(consolePage.includes('http://localhost:8787/admin/'), 'crawler-console.html should redirect local file previews directly to the admin server.');
assert.ok(adminIndex.includes('../images/robot-login.png'), 'admin/index.html should use the clean login robot cutout.');
assert.ok(adminIndex.includes('admin-open-help'), 'admin/index.html should include local server help for login.');
assert.ok(!adminIndex.includes('value="13539770556"'), 'admin/index.html should not prefill the private account for other visitors.');
assert.ok(adminIndex.includes('autocomplete="off"'), 'admin/index.html should turn off credential autofill hints.');
assert.ok(adminStyle.includes('.admin-open-help { display: none;'), 'admin help should be hidden until the API is unavailable.');
assert.ok(adminApp.includes('当前是静态文件预览'), 'admin/app.js should explain failed local file login.');
assert.ok(adminApp.includes('adminOpenHelp') && adminApp.includes("classList.add('visible')"), 'admin/app.js should reveal local help only on connection failure.');
assert.ok(adminApp.includes('window.setInterval(loadLogs, 60000)'), 'admin/app.js should auto-refresh live crawler data every 60 seconds.');
assert.ok(adminApp.includes('&_=') && adminApp.includes('Date.now()'), 'admin/app.js should add a cache-busting timestamp for live log queries.');
assert.ok(adminApp.includes("'Cache-Control': 'no-cache'"), 'admin/app.js should send no-cache requests for log data.');
assert.ok(adminIndex.includes('lastRefreshText'), 'admin/index.html should show the last live refresh time.');
assert.ok(profile.includes('images/robot-neutral.png'), 'profile.html should use the clean neutral robot cutout.');

for (const slug of articleSlugs) {
  const href = `articles/${slug}.html`;
  assert.ok(profile.includes(href), `profile.html should link to ${href}.`);
  assert.ok(read('sitemap.xml').includes(`https://www.lxue.xin/${href}`), `sitemap.xml should include ${href}.`);
  assert.ok(read('llms.txt').includes(`/${href}`), `llms.txt should include ${href}.`);
  assert.ok(read('robots.txt').includes(`/${href}`), `robots.txt should explicitly allow ${href}.`);

  const html = read(href);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${href} should have exactly one h1.`);
  assert.ok(html.includes(`https://www.lxue.xin/${href}`), `${href} should have a canonical absolute URL.`);
  assert.ok(html.includes('"@type": "Article"'), `${href} should include Article schema.`);
  assert.ok(html.includes('"@type": "BreadcrumbList"'), `${href} should include BreadcrumbList schema.`);
  assert.ok(html.includes('"@type": "FAQPage"'), `${href} should include FAQPage schema.`);
  assert.ok(html.includes('article-ai-pattern'), `${href} should include AI visual pattern styling hook.`);
  assert.ok(!html.includes('display:none') && !html.includes('visibility:hidden'), `${href} should not hide text from users.`);
}

const adminServer = read('admin/server.mjs');
for (const expected of [
  'HttpOnly',
  'ADMIN_PASSWORD_HASH',
  'TENCENT_CLS_TOPIC_ID',
  'SearchLog',
  '/api/admin/crawler-logs'
]) {
  assert.ok(adminServer.includes(expected), `admin/server.mjs should include ${expected}.`);
}

console.log('AI platform topic and admin surface validation passed.');
