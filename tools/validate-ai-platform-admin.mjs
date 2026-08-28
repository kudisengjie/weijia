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
  'images/robot-neutral.png',
  'images/robot-doubao.png',
  'images/robot-deepseek.png'
]) {
  assert.ok(exists(relPath), `${relPath} should exist.`);
}

const profile = read('profile.html');
const script = read('script.js');
assert.ok(profile.includes('ai-platform-topics'), 'profile.html should include the AI platform topics module.');
assert.ok(script.includes('geo-workbench-entry'), 'script.js should inject the private GEO workbench entry.');
assert.ok(script.includes("'零雪 GEO 程序'"), 'the Chinese footer entry should use the exact product name.');
assert.ok(script.includes("'Lxue GEO Workbench'"), 'the English footer entry should identify the Lxue product.');
assert.ok(script.includes("'https://geo.lxue.xin/'"), 'script.js should link the footer entry to the private GEO workbench.');
assert.ok(script.includes('打开零雪 GEO 私有文章工作台'), 'the footer entry should expose an exact accessible label.');
assert.ok(!exists('crawler-console.html'), 'retired crawler console page must stay removed.');
assert.ok(!exists('admin/index.html'), 'retired crawler admin must stay removed.');
assert.ok(profile.includes('src="images/lxue-ice-elf-wave-transparent.png"'), 'profile.html should use the exact approved transparent ice-elf mascot source.');
assert.ok(!profile.includes('src="images/yirui-robot-wave-cutout.png"'), 'profile.html should not use the retired Yirui robot mascot source.');

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

console.log('AI platform topic and private GEO workbench entry validation passed.');
