# Unified Navbar GEO Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a polished, responsive “零雪 GEO 程序” entry to the seven main-site navigation bars while preserving every article-detail navigation unchanged.

**Architecture:** Keep the existing static-site architecture: the seven in-scope HTML files receive the same explicit navigation contract, while `style.css`, `script.js`, and `i18n.js` provide shared presentation, behavior, and bilingual labels. Scope every new visual rule and enhanced interaction to `nav[data-unified-nav]`, so the shared assets cannot alter article pages. A Node validation script enforces markup, link, order, accessibility, localization, and article-exclusion invariants before official Google Chrome QA.

**Tech Stack:** Static HTML5, CSS3, vanilla JavaScript, Node.js ESM validation scripts, Microsoft Playwright CLI using the installed Google Chrome channel only.

---

## Source specification

- `docs/superpowers/specs/2026-08-27-unified-navbar-geo-entry-design.md`

## Scope check

This plan covers one subsystem only: the public website header navigation. It does not change the static GEO workbench, the local GEO generator, IMA, DeepSeek, authentication, deployment infrastructure, article bodies, or article-detail navigation.

## File responsibility map

**Create**

- `tools/validate-unified-navbar.mjs` — executable contract for the seven unified navigation bars and the article-page exclusion boundary.

**Modify**

- `.gitignore` — exclude browser-session and screenshot evidence from deployable source.
- `index.html` — unified home navigation; home remains the active item.
- `profile.html` — unified brand navigation; brand remains the active item.
- `blog/index.html` — unified blog navigation; blog remains the active item.
- `geo-guide.html` — unified guide navigation; guide remains the active item.
- `insights.html` — unified strategy navigation; strategy remains the active item.
- `support.html` — unified Q&A navigation; Q&A remains the active item.
- `brand-facts.html` — unified navigation with no false active item.
- `style.css` — scoped desktop capsule, early-collapse layout, two-column mobile menu, focus states, and reduced-motion behavior.
- `script.js` — enhanced open/close state for unified navigation with an exact legacy fallback for article pages.
- `i18n.js` — Chinese/English workbench text, accessible menu label, new-tab announcement, and translated `aria-label` support.
- `tools/validate-footer-i18n.mjs` — recognize the new cache version on the seven main pages while preserving the article-page cache contract.

**Must remain unchanged**

- `articles/**/*.html`
- `geo-site/**`
- User-owned untracked files and directories.

### Task 1: Add a failing navigation contract

**Files:**
- Create: `tools/validate-unified-navbar.mjs`

- [ ] **Step 1: Create the contract validator**

Add the complete file below:

```js
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
```

- [ ] **Step 2: Run the validator and prove it fails before implementation**

Run:

```powershell
node tools/validate-unified-navbar.mjs
```

Expected: exit code `1`; the first failures include `index.html: missing unified navigation marker`, `style.css: unified navigation block is missing`, and `script.js: missing setUnifiedMenuOpen`.

- [ ] **Step 3: Ignore browser-only QA artifacts**

Append exactly:

```gitignore
# Browser QA artifacts
.playwright-cli/
output/playwright/
```

- [ ] **Step 4: Commit the failing contract and artifact boundary**

```powershell
git add -- .gitignore tools/validate-unified-navbar.mjs
git commit -m "test: define unified navbar contract"
```

### Task 2: Apply one canonical navigation structure and bilingual labels

**Files:**
- Modify: `index.html:157-176`
- Modify: `profile.html` (existing `<nav class="navbar">` block)
- Modify: `blog/index.html` (existing `<nav class="navbar">` block)
- Modify: `geo-guide.html` (existing `<nav class="navbar">` block)
- Modify: `insights.html` (existing `<nav class="navbar">` block)
- Modify: `support.html` (existing `<nav class="navbar">` block)
- Modify: `brand-facts.html` (existing `<nav class="navbar">` block)
- Modify: `i18n.js:41-53,60-66,694-700`
- Modify: `tools/validate-footer-i18n.mjs:34-46`

- [ ] **Step 1: Replace each in-scope navigation with the canonical markup**

Use this exact structure in all seven pages. Apply `class="active"` only according to the mapping below the code block.

```html
<nav class="navbar" data-unified-nav>
    <div class="container">
        <div class="logo"><span class="brand-name">零雪AI-Genesis</span></div>
        <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="primary-navigation" data-i18n-aria-label="nav.menu" aria-label="导航菜单">
            <span aria-hidden="true"></span>
            <span aria-hidden="true"></span>
            <span aria-hidden="true"></span>
        </button>
        <ul class="nav-links" id="primary-navigation">
            <li><a href="/" data-i18n="nav.home">首页</a></li>
            <li><a href="/profile" data-i18n="nav.about">品牌详情</a></li>
            <li><a href="/blog/index" data-i18n="nav.blog">行业博客</a></li>
            <li><a href="/geo-guide" data-i18n="nav.geo">GEO指南</a></li>
            <li><a href="/insights" data-i18n="nav.cases">GEO策略</a></li>
            <li><a href="/support" data-i18n="nav.faq">AI问答</a></li>
            <li class="nav-tool-item">
                <a class="nav-geo-workbench" href="https://geo.lxue.xin/" target="_blank" rel="nofollow noopener noreferrer">
                    <span data-i18n="nav.workbench">零雪 GEO 程序</span>
                    <span class="sr-only" data-i18n="nav.newTab">（在新标签页打开）</span>
                </a>
            </li>
            <li class="nav-language-item"><a href="#" class="lang-switch-mobile" data-i18n="nav.lang">English</a></li>
        </ul>
        <div class="nav-actions">
            <a href="#" class="lang-switch" data-i18n="nav.lang">English</a>
        </div>
    </div>
</nav>
```

Active-item mapping:

```text
index.html       nav.home
profile.html     nav.about
blog/index.html  nav.blog
geo-guide.html   nav.geo
insights.html    nav.cases
support.html     nav.faq
brand-facts.html no active item
```

For each mapped page, place `class="active"` on the mapped `<a>` immediately after its `href` attribute and before `data-i18n`; do not add `active` anywhere else.

- [ ] **Step 2: Bump shared asset versions only on the seven main pages**

Replace the existing query strings while preserving relative paths:

```html
style.css?v=20260827
script.js?v=20260827
```

Expected: root pages use `style.css?v=20260827` and `script.js?v=20260827`; `blog/index.html` uses `../style.css?v=20260827` and `../script.js?v=20260827`; no file under `articles/` changes.

- [ ] **Step 3: Add translated aria-label processing in `i18n.switchLang`**

Insert this block after the existing `[data-i18n-placeholder]` loop and before `document.documentElement.lang`:

```js
document.querySelectorAll('[data-i18n-aria-label]').forEach(function(el) {
    var key = el.getAttribute('data-i18n-aria-label');
    if (dict[key] !== undefined) {
        el.setAttribute('aria-label', dict[key]);
    }
});
```

- [ ] **Step 4: Add the exact Chinese and English navigation keys**

Add beside the existing `nav.*` entries:

```js
// zh
'nav.workbench': '零雪 GEO 程序',
'nav.newTab': '（在新标签页打开）',
'nav.menu': '导航菜单',

// en
'nav.workbench': 'Lxue GEO Workbench',
'nav.newTab': ' (opens in a new tab)',
'nav.menu': 'Navigation menu',
```

- [ ] **Step 5: Keep the footer/i18n cache-version validator accurate**

Add this set near `trackedHtmlFiles`, before the assertion loop:

```js
const unifiedNavPages = new Set([
  'index.html',
  'profile.html',
  'blog/index.html',
  'geo-guide.html',
  'insights.html',
  'support.html',
  'brand-facts.html'
]);
```

Replace the fixed stylesheet-version assertion inside the `icpHtmlFiles` loop with:

```js
const normalizedFile = file.replace(/\\/g, '/');
const expectedStyleVersion = unifiedNavPages.has(normalizedFile) ? '20260827' : '20260812';
assert(
  new RegExp(`(?:\\.\\.\\/)*style\\.css\\?v=${expectedStyleVersion}(?:["'])`).test(html),
  `${file} should load stylesheet version ${expectedStyleVersion}.`
);
```

- [ ] **Step 6: Run the focused validators**

```powershell
node tools/validate-unified-navbar.mjs
node tools/validate-footer-i18n.mjs
```

Expected: `validate-footer-i18n.mjs` passes. The unified validator still exits `1`, but all HTML, link, order, i18n, cache-version, and article-exclusion failures are gone; only the planned CSS and JavaScript behavior failures remain.

- [ ] **Step 7: Confirm article HTML is untouched**

```powershell
git diff --exit-code -- articles
```

Expected: no output and exit code `0`.

- [ ] **Step 8: Commit the canonical structure and translations**

```powershell
git add -- index.html profile.html blog/index.html geo-guide.html insights.html support.html brand-facts.html i18n.js tools/validate-footer-i18n.mjs
git commit -m "feat: add GEO entry to main navigation"
```

### Task 3: Implement the scoped desktop, tablet, and mobile visual system

**Files:**
- Modify: `style.css` (append after current shared navigation and visual-refresh rules)

- [ ] **Step 1: Append the complete scoped navigation stylesheet**

```css
/* ===== Unified main-site navigation ===== */
.sr-only {
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    padding: 0 !important;
    margin: -1px !important;
    overflow: hidden !important;
    clip: rect(0, 0, 0, 0) !important;
    white-space: nowrap !important;
    border: 0 !important;
}

.navbar[data-unified-nav] .container {
    gap: clamp(10px, 1.4vw, 24px);
}

.navbar[data-unified-nav] .logo {
    flex: 0 0 auto;
}

.navbar[data-unified-nav] .nav-links {
    align-items: center;
    gap: 2px;
    margin-left: auto;
}

.navbar[data-unified-nav] .nav-links a,
.navbar[data-unified-nav] .lang-switch {
    min-height: 44px;
    box-sizing: border-box;
}

.navbar[data-unified-nav] .nav-links a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 8px 11px;
}

.navbar[data-unified-nav] .nav-tool-item {
    margin-left: 6px;
}

.navbar[data-unified-nav] .nav-geo-workbench {
    min-height: 44px;
    border: 1px solid rgba(69, 132, 203, 0.35);
    border-radius: 999px;
    padding: 8px 15px;
    color: #174d82;
    background: linear-gradient(135deg, rgba(235, 247, 255, 0.98), rgba(221, 239, 255, 0.9));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 5px 16px rgba(46, 104, 169, 0.1);
    font-weight: 750;
    letter-spacing: 0.01em;
    transition: color 0.2s ease, border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.navbar[data-unified-nav] .nav-geo-workbench:hover {
    color: #103f70;
    border-color: rgba(48, 108, 178, 0.55);
    background: linear-gradient(135deg, #eef9ff, #d8edff);
    box-shadow: inset 0 1px 0 #ffffff, 0 8px 20px rgba(46, 104, 169, 0.16);
    transform: translateY(-1px);
}

.navbar[data-unified-nav] a:focus-visible,
.navbar[data-unified-nav] .menu-toggle:focus-visible {
    outline: 3px solid rgba(56, 123, 199, 0.38);
    outline-offset: 3px;
}

.navbar[data-unified-nav] .menu-toggle {
    border: 0;
    border-radius: 12px;
    background: transparent;
    padding: 10px 8px;
    min-width: 44px;
    width: 44px;
    min-height: 44px;
    height: 44px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
}

.navbar[data-unified-nav] .menu-toggle span {
    width: 24px;
    margin: 0;
}

.navbar[data-unified-nav] .nav-language-item {
    display: none;
}

@media (max-width: 1180px) {
    .navbar[data-unified-nav] .container {
        position: relative;
        justify-content: space-between;
    }

    .navbar[data-unified-nav] .menu-toggle {
        display: flex;
    }

    .navbar[data-unified-nav] .nav-actions {
        display: none;
    }

    .navbar[data-unified-nav] .nav-links {
        display: none;
        position: fixed;
        top: 70px;
        left: 24px;
        right: 24px;
        width: auto;
        max-height: calc(100dvh - 94px);
        overflow-y: auto;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        margin: 0;
        padding: 16px;
        border: 1px solid rgba(65, 113, 165, 0.18);
        border-radius: 18px;
        background: rgba(250, 253, 255, 0.98);
        box-shadow: 0 20px 50px rgba(24, 63, 105, 0.16);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
    }

    .navbar[data-unified-nav] .nav-links.active {
        display: grid;
    }

    .navbar[data-unified-nav] .nav-links li {
        margin: 0;
        padding: 0;
        border: 0;
        min-width: 0;
    }

    .navbar[data-unified-nav] .nav-links a {
        width: 100%;
        min-height: 48px;
        padding: 10px 12px;
        border-radius: 12px;
        text-align: center;
    }

    .navbar[data-unified-nav] .nav-tool-item,
    .navbar[data-unified-nav] .nav-language-item {
        grid-column: 1 / -1;
    }

    .navbar[data-unified-nav] .nav-tool-item {
        margin: 4px 0 0;
    }

    .navbar[data-unified-nav] .nav-geo-workbench {
        width: 100%;
    }

    .navbar[data-unified-nav] .nav-language-item {
        display: block;
        padding-top: 8px;
        border-top: 1px solid rgba(65, 113, 165, 0.14);
    }

    .navbar[data-unified-nav] .nav-links .lang-switch-mobile {
        display: flex !important;
        margin: 0;
        border-radius: 12px;
    }
}

@media (max-width: 768px) {
    .navbar[data-unified-nav] .nav-links {
        top: 60px;
        left: 12px;
        right: 12px;
        max-height: calc(100dvh - 72px);
        padding: 12px;
        border-radius: 16px;
    }

    .navbar[data-unified-nav] .nav-links a {
        font-size: 0.92rem;
    }
}

@media (max-width: 390px) {
    .navbar[data-unified-nav] .nav-links {
        gap: 7px;
        padding: 10px;
    }

    .navbar[data-unified-nav] .nav-links a {
        padding-inline: 8px;
        font-size: 0.88rem;
    }
}

@media (prefers-reduced-motion: reduce) {
    .navbar[data-unified-nav] .nav-geo-workbench {
        transition: none;
    }

    .navbar[data-unified-nav] .nav-geo-workbench:hover {
        transform: none;
    }
}
```

- [ ] **Step 2: Run the contract validator**

```powershell
node tools/validate-unified-navbar.mjs
```

Expected: CSS failures disappear. The validator still exits `1` only for the planned JavaScript behavior tokens.

- [ ] **Step 3: Commit the responsive visual system**

```powershell
git add -- style.css
git commit -m "style: unify responsive site navigation"
```

### Task 4: Implement deterministic menu behavior with a legacy article fallback

**Files:**
- Modify: `script.js:1-14`

- [ ] **Step 1: Replace the current opening menu block with the exact enhanced/fallback implementation**

```js
var unifiedNavbar = document.querySelector('.navbar[data-unified-nav]');
var menuToggle = unifiedNavbar ? unifiedNavbar.querySelector('.menu-toggle') : document.querySelector('.menu-toggle');
var navLinks = unifiedNavbar ? unifiedNavbar.querySelector('.nav-links') : document.querySelector('.nav-links');

function setUnifiedMenuOpen(open) {
    if (!unifiedNavbar || !menuToggle || !navLinks) return;
    menuToggle.classList.toggle('active', open);
    navLinks.classList.toggle('active', open);
    menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

if (menuToggle && navLinks) {
    if (unifiedNavbar) {
        menuToggle.addEventListener('click', function() {
            setUnifiedMenuOpen(menuToggle.getAttribute('aria-expanded') !== 'true');
        });

        navLinks.querySelectorAll('a').forEach(function(link) {
            link.addEventListener('click', function() {
                setUnifiedMenuOpen(false);
            });
        });

        document.addEventListener('click', function(event) {
            if (!unifiedNavbar.contains(event.target)) {
                setUnifiedMenuOpen(false);
            }
        });

        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') {
                setUnifiedMenuOpen(false);
                menuToggle.focus();
            }
        });

        window.addEventListener('resize', function() {
            if (window.innerWidth > 1180) {
                setUnifiedMenuOpen(false);
            }
        });
    } else {
        menuToggle.addEventListener('click', function() {
            this.classList.toggle('active');
            navLinks.classList.toggle('active');
        });

        document.querySelectorAll('.nav-links a').forEach(function(link) {
            link.addEventListener('click', function() {
                menuToggle.classList.remove('active');
                navLinks.classList.remove('active');
            });
        });
    }
}
```

- [ ] **Step 2: Run the focused contract to green**

```powershell
node tools/validate-unified-navbar.mjs
```

Expected: exit code `0` and `Unified navigation validation passed for 7 main pages; article navigation remains excluded.`

- [ ] **Step 3: Commit the menu behavior**

```powershell
git add -- script.js
git commit -m "fix: make unified mobile navigation deterministic"
```

### Task 5: Run the complete static regression suite

**Files:**
- Test: `tools/validate-*.mjs`
- Verify unchanged: `articles/**/*.html`
- Verify unchanged: `geo-site/**`

- [ ] **Step 1: Run every repository validator**

```powershell
Get-ChildItem -LiteralPath 'tools' -Filter 'validate-*.mjs' | Sort-Object Name | ForEach-Object {
    Write-Output "Running $($_.Name)"
    node $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "$($_.Name) failed" }
}
```

Expected: every script exits `0`; the final unified-navigation message reports seven main pages and excluded article navigation.

- [ ] **Step 2: Check whitespace and scope**

```powershell
git diff --check
git diff --exit-code -- articles
git status --short
```

Expected: `git diff --check` and the article diff return no output. `git status --short` lists no modified article, `geo-site`, image, Word, artifact, or user-owned untracked path caused by this task.

- [ ] **Step 3: Inspect the implementation diff against the design**

```powershell
git diff HEAD~4 -- index.html profile.html blog/index.html geo-guide.html insights.html support.html brand-facts.html style.css script.js i18n.js tools/validate-unified-navbar.mjs tools/validate-footer-i18n.mjs
```

Expected: only the seven scoped navigation bars, shared scoped styles/behavior/i18n, cache validator, and new navigation validator appear.

### Task 6: Verify in official Google Chrome at all required sizes

**Files:**
- Runtime artifacts only: `output/playwright/navbar-*.png`

- [ ] **Step 1: Start a temporary local static server without adding dependencies**

Run in a PTY and keep the session id for later shutdown:

```powershell
node -e "const http=require('http'),fs=require('fs'),path=require('path'),root=process.cwd();http.createServer((req,res)=>{let url=decodeURIComponent(req.url.split('?')[0]);if(url==='/')url='/index.html';let file=path.join(root,url);if(!path.extname(file))file+='.html';if(!file.startsWith(root)||!fs.existsSync(file)){res.statusCode=404;return res.end('Not found')}const type={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';res.setHeader('Content-Type',type);res.end(fs.readFileSync(file))}).listen(4173,'127.0.0.1',()=>console.log('http://127.0.0.1:4173'))"
```

Expected: `http://127.0.0.1:4173`.

- [ ] **Step 2: Open a named Playwright CLI session using the installed official Google Chrome channel**

```powershell
New-Item -ItemType Directory -Force -Path 'output/playwright' | Out-Null
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar open http://127.0.0.1:4173/ --browser=chrome --headed
```

Expected: the process identifies Chrome, not Chromium, and opens the homepage in Google Chrome. Microsoft’s official CLI documents `--browser=chrome` as the branded Chrome channel; do not omit this flag.

- [ ] **Step 3: Validate desktop layouts and capture evidence**

```powershell
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar resize 1440 900
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar eval "() => ({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, workbench: document.querySelector('.nav-geo-workbench')?.textContent.trim(), menuVisible: getComputedStyle(document.querySelector('.menu-toggle')).display !== 'none' })"
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar screenshot --filename=output/playwright/navbar-home-1440.png
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar resize 1280 800
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar screenshot --filename=output/playwright/navbar-home-1280.png
```

Expected at both sizes: `overflow: false`; the workbench text is `零雪 GEO 程序`; at 1440 the menu button is hidden and the capsule sits between AI问答 and English without wrapping.

- [ ] **Step 4: Validate the 1024px collapsed menu behavior**

```powershell
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar resize 1024 768
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar click "role=button[name=导航菜单]"
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar eval "() => ({ expanded: document.querySelector('.menu-toggle').getAttribute('aria-expanded'), display: getComputedStyle(document.querySelector('.nav-links')).display, columns: getComputedStyle(document.querySelector('.nav-links')).gridTemplateColumns, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth })"
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar screenshot --filename=output/playwright/navbar-home-1024-open.png
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar press Escape
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar eval "() => document.querySelector('.menu-toggle').getAttribute('aria-expanded')"
```

Expected: open state reports `expanded: "true"`, `display: "grid"`, two grid columns, and `overflow: false`; after Escape the value is `false`.

- [ ] **Step 5: Validate 390px and 360px mobile layouts**

```powershell
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar resize 390 844
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar click "role=button[name=导航菜单]"
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar eval "() => ({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, workbenchWidth: Math.round(document.querySelector('.nav-tool-item').getBoundingClientRect().width), menuWidth: Math.round(document.querySelector('.nav-links').getBoundingClientRect().width), minLinkHeight: Math.min(...[...document.querySelectorAll('.nav-links a')].map(link => link.getBoundingClientRect().height)) })"
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar screenshot --filename=output/playwright/navbar-home-390-open.png
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar resize 360 800
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar screenshot --filename=output/playwright/navbar-home-360-open.png
```

Expected: `overflow: false`; workbench width approximately equals menu content width; minimum link height is at least `44`; six content items remain in two columns; GEO and language each occupy a separate full row.

- [ ] **Step 6: Verify the external link opens the exact destination in a new tab**

```powershell
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar run-code "const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('.nav-geo-workbench').click()]); await popup.waitForLoadState('domcontentloaded'); console.log(popup.url()); await popup.close();"
```

Expected: `https://geo.lxue.xin/` (an optional trailing slash is acceptable) and the original homepage tab remains open.

- [ ] **Step 7: Traverse all seven main pages and verify one shared shell**

Run `goto`, `eval`, and `screenshot` for each path:

```powershell
$paths = @('/', '/profile', '/blog/index', '/geo-guide', '/insights', '/support', '/brand-facts')
foreach ($path in $paths) {
    npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar goto "http://127.0.0.1:4173$path"
    npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar eval "() => ({ unified: !!document.querySelector('nav[data-unified-nav]'), workbenchCount: document.querySelectorAll('.nav-geo-workbench').length, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth })"
}
```

Expected on every page: `unified: true`, `workbenchCount: 1`, `overflow: false`.

- [ ] **Step 8: Inspect captured PNGs and close all test processes**

Open each PNG with the local image viewer and confirm: no clipping, no collision, no arrow, correct active state, even spacing, readable two-column mobile menu, full-width GEO row, and separate language row.

```powershell
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar close
```

Then stop the saved Node server session with `Ctrl+C`.

### Task 7: Final review, commit integrity, and push to the official repository

**Files:**
- Review only: all task files

- [ ] **Step 1: Re-run the complete regression suite after browser QA**

```powershell
Get-ChildItem -LiteralPath 'tools' -Filter 'validate-*.mjs' | Sort-Object Name | ForEach-Object {
    node $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "$($_.Name) failed" }
}
git diff --check
git diff --exit-code -- articles
```

Expected: every validator passes, whitespace check is clean, and article diff is empty.

- [ ] **Step 2: Confirm repository identity and commit scope**

```powershell
git branch --show-current
git remote get-url origin
git status --short
git log --oneline -6
```

Expected: branch `master`; origin `https://github.com/kudisengjie/weijia.git`; no task-related changes are uncommitted; unrelated user-owned untracked files remain untouched.

- [ ] **Step 3: Push the verified commits**

```powershell
git push origin master
```

Expected: GitHub accepts the new commits and updates `master` without creating another branch.

- [ ] **Step 4: Verify the deployed public pages in official Chrome**

```powershell
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar-live open https://www.lxue.xin/ --browser=chrome --headed
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar-live resize 1440 900
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar-live eval "() => ({ unified: !!document.querySelector('nav[data-unified-nav]'), workbenchHref: document.querySelector('.nav-geo-workbench')?.href, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth })"
npx --yes --package @playwright/cli playwright-cli -s=lxue-navbar-live close
```

Expected after EdgeOne deployment completes: `unified: true`, `workbenchHref: "https://geo.lxue.xin/"`, and `overflow: false`.
