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
  'images/yirui-robot-transparent.png'
]) {
  assert.ok(exists(relPath), `${relPath} should exist.`);
}

const profile = read('profile.html');
const script = read('script.js');
const consolePage = read('crawler-console.html');
assert.ok(profile.includes('ai-platform-topics'), 'profile.html should include the AI platform topics module.');
assert.ok(script.includes('crawler-console-entry'), 'script.js should inject the hidden crawler console entry.');
assert.ok(consolePage.includes('admin/'), 'crawler-console.html should embed the admin route.');

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
