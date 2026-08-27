import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const pages = [
  'index.html',
  'profile.html',
  'blog/index.html',
  'geo-guide.html',
  'insights.html',
  'support.html',
  'brand-facts.html'
];
const expectedKeys = [
  'nav.home',
  'nav.about',
  'nav.blog',
  'nav.geo',
  'nav.cases',
  'nav.faq',
  'nav.workbench',
  'nav.newTab',
  'nav.lang',
  'nav.lang'
];
const expectedActive = new Map([
  ['index.html', 'nav.home'],
  ['profile.html', 'nav.about'],
  ['blog/index.html', 'nav.blog'],
  ['geo-guide.html', 'nav.geo'],
  ['insights.html', 'nav.cases'],
  ['support.html', 'nav.faq'],
  ['brand-facts.html', null]
]);
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

for (const page of pages) {
  const html = read(page);
  const nav = html.match(/<nav class="navbar" data-unified-nav>[\s\S]*?<\/nav>/)?.[0] || '';
  expect(Boolean(nav), `${page}: missing unified navigation marker`);
  if (!nav) continue;

  expect(count(nav, /class="nav-geo-workbench"/g) === 1, `${page}: workbench link must appear once`);
  expect(nav.includes('href="https://geo.lxue.xin/"'), `${page}: incorrect workbench URL`);
  expect(nav.includes('target="_blank"'), `${page}: workbench must open a new tab`);
  expect(nav.includes('rel="nofollow noopener noreferrer"'), `${page}: workbench rel contract is incomplete`);
  expect(nav.includes('data-i18n="nav.workbench"'), `${page}: missing workbench translation key`);
  expect(nav.includes('data-i18n="nav.newTab"'), `${page}: missing accessible new-tab text`);
  expect(!nav.includes('→') && !nav.includes('&rarr;'), `${page}: workbench link must not show an arrow`);
  expect(nav.includes('<button class="menu-toggle" type="button"'), `${page}: menu control must be a button`);
  expect(nav.includes('aria-expanded="false"'), `${page}: menu button needs aria-expanded`);
  expect(nav.includes('aria-controls="primary-navigation"'), `${page}: menu button needs aria-controls`);
  expect(nav.includes('data-i18n-aria-label="nav.menu"'), `${page}: menu button needs a translated label`);
  expect(nav.includes('<ul class="nav-links" id="primary-navigation">'), `${page}: menu id contract is missing`);

  const keys = [...nav.matchAll(/data-i18n="(nav\.[^"]+)"/g)].map((match) => match[1]);
  expect(JSON.stringify(keys) === JSON.stringify(expectedKeys), `${page}: navigation item order drifted: ${keys.join(', ')}`);

  const activeKeys = [...nav.matchAll(/<a[^>]*class="[^"]*active[^"]*"[^>]*data-i18n="(nav\.[^"]+)"/g)].map((match) => match[1]);
  const active = expectedActive.get(page);
  expect(active ? activeKeys.length === 1 && activeKeys[0] === active : activeKeys.length === 0, `${page}: incorrect active navigation item`);

  expect(html.includes('style.css?v=20260827'), `${page}: stylesheet cache version was not updated`);
  expect(html.includes('script.js?v=20260827'), `${page}: script cache version was not updated`);
}

const i18n = read('i18n.js');
for (const token of [
  "'nav.workbench': '零雪 GEO 程序'",
  "'nav.workbench': 'Lxue GEO Workbench'",
  "'nav.newTab': '（在新标签页打开）'",
  "'nav.newTab': ' (opens in a new tab)'",
  "'nav.menu': '导航菜单'",
  "'nav.menu': 'Navigation menu'",
  "querySelectorAll('[data-i18n-aria-label]')"
]) {
  expect(i18n.includes(token), `i18n.js: missing ${token}`);
}

const css = read('style.css');
expect(css.includes('/* ===== Unified main-site navigation ===== */'), 'style.css: unified navigation block is missing');
expect(css.includes('.navbar[data-unified-nav] .nav-geo-workbench'), 'style.css: workbench capsule is missing');
expect(/@media\s*\(max-width:\s*1180px\)[\s\S]*?\.navbar\[data-unified-nav\][\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s.test(css), 'style.css: two-column collapsed menu is missing');
expect(/\.navbar\[data-unified-nav\][\s\S]*?min-height:\s*44px/s.test(css), 'style.css: 44px touch target contract is missing');
expect(css.includes('.navbar[data-unified-nav] .nav-language-item'), 'style.css: separate mobile language row is missing');
expect(css.includes('.sr-only'), 'style.css: accessible visually hidden helper is missing');

const script = read('script.js');
for (const token of [
  'setUnifiedMenuOpen',
  "event.key === 'Escape'",
  "window.addEventListener('resize'",
  "unifiedNavbar.contains(event.target)",
  "menuToggle.setAttribute('aria-expanded'"
]) {
  expect(script.includes(token), `script.js: missing ${token}`);
}

function inspectArticleTree(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      inspectArticleTree(fullPath);
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;
    const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
    const html = read(relativePath);
    expect(!html.includes('data-unified-nav'), `${relativePath}: article navigation must remain legacy`);
    expect(!html.includes('nav.workbench'), `${relativePath}: article navigation must not receive the workbench entry`);
  }
}

inspectArticleTree(path.join(root, 'articles'));

if (failures.length) {
  console.error('Unified navigation validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Unified navigation validation passed for 7 main pages; article navigation remains excluded.');
