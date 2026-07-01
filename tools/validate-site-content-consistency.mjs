import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1')), '..');
const htmlFiles = [];
const textFiles = [];
const ignoredDirs = new Set(['.git', 'node_modules', 'admin']);

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (/\.(html|js|txt|xml|css)$/i.test(entry.name)) textFiles.push(fullPath);
    if (entry.isFile() && /\.html$/i.test(entry.name)) htmlFiles.push(fullPath);
  }
}

walk(root);

const suspiciousTokens = [
  '\uFFFD',
  '\u951b',
  '\u9426',
  '\u93c2',
  '\u7487',
  '\u8e47',
  '\u7015',
  '\u8119',
  '\u8117',
  '\u8292\u9207',
  '\u003f\u003f',
  '\u951b\u71c2\u7d35'
].map((token) => JSON.parse('"' + token + '"'));

const oldCaseLabel = '\u6848\u4f8b\u4e0e\u89c1\u89e3';
const geoGuideLabel = 'GEO\u6307\u5357';
const geoStrategyLabel = 'GEO\u7b56\u7565\u4e2d\u5fc3';
const oldVendorTitle = 'GEO\u670d\u52a1\u5546\u600e\u4e48\u9009\uff1f2024\u6700\u5168\u9009\u578b\u6307\u5357\uff1a8\u5bb6\u670d\u52a1\u5546\u6df1\u5ea6\u6a2a\u8bc4';
const phone = '13539770556';
const email = '1914224955@qq.com';
const aiTopicPages = new Set([
  'articles/deepseek-geo-evidence-density-strategy.html',
  'articles/doubao-byte-geo-indexing-strategy.html'
]);

const failures = [];

for (const file of textFiles) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const content = fs.readFileSync(file, 'utf8');
  for (const token of suspiciousTokens) {
    if (content.includes(token)) failures.push(`${rel}: suspicious mojibake token ${JSON.stringify(token)}`);
  }
  if (content.includes(oldCaseLabel)) {
    failures.push(`${rel}: old navigation label should be GEO Strategy Center`);
  }
}

for (const file of htmlFiles) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const content = fs.readFileSync(file, 'utf8');
  const isRedirectOnly = rel === 'blog.html' || rel === 'crawler-console.html';
  if (!isRedirectOnly && content.includes('<footer')) {
    if (!content.includes(phone)) failures.push(`${rel}: missing standard phone ${phone}`);
    if (!content.includes(email)) failures.push(`${rel}: missing standard email ${email}`);
  }
  if (!isRedirectOnly && content.includes('<nav')) {
    if (!content.includes(geoGuideLabel)) failures.push(`${rel}: navigation should include GEO Guide`);
    if (!content.includes(geoStrategyLabel)) failures.push(`${rel}: navigation should include GEO Strategy Center`);
  }
  if (rel === 'articles/geo-vendor-selection.html' && content.includes(oldVendorTitle)) {
    failures.push(`${rel}: vendor selection article still contains outdated 2024 title`);
  }
  if (aiTopicPages.has(rel) && content.includes('href="../blog/index.html" class="active"')) {
    failures.push(`${rel}: AI platform topic pages should not highlight blog navigation`);
  }
}

assert.deepEqual(failures, []);
console.log(`Validated ${textFiles.length} text assets and ${htmlFiles.length} HTML pages for content consistency.`);
