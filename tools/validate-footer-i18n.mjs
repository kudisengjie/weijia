import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function makeElement(key, text, inFooter = false) {
  return {
    textContent: text,
    placeholder: '',
    getAttribute(name) {
      if (name === 'data-i18n' || name === 'data-i18n-placeholder') return key;
      return null;
    },
    closest(selector) {
      return selector === '.footer' && inFooter ? {} : null;
    }
  };
}

const footerBrand = makeElement('footer.brand', '零雪AI GEO优化', true);
const footerDesc = makeElement('footer.desc', '专注GEO优化，用AI重塑企业流量架构', true);
const footerIcp = makeElement('footer.icp', '粤ICP备2026018563号', true);
const recentTitle = makeElement('recent.title', '近期文章', false);
const heroPrefix = makeElement('hero.ai.answer.prefix', '为您推荐：', false);
const navHome = makeElement('nav.home', '首页', false);
const langButton = { textContent: 'English', addEventListener() {} };

const script = fs.readFileSync('script.js', 'utf8');
const css = fs.readFileSync('style.css', 'utf8');
const trackedHtmlFiles = [];
const unifiedNavPages = new Set([
  'index.html',
  'profile.html',
  'blog/index.html',
  'geo-guide.html',
  'insights.html',
  'support.html',
  'brand-facts.html'
]);

function collectTrackedHtmlFiles(dir = '.') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', '.worktrees', 'artifacts', 'node_modules'].includes(entry.name)) continue;
    const relativePath = dir === '.' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) collectTrackedHtmlFiles(relativePath);
    else if (entry.name.endsWith('.html')) trackedHtmlFiles.push(relativePath);
  }
}

collectTrackedHtmlFiles();
const icpHtmlFiles = trackedHtmlFiles.filter((file) =>
  fs.readFileSync(file, 'utf8').includes('https://beian.miit.gov.cn/#/Integrated/index')
);

assert.equal(icpHtmlFiles.length, 33, 'all 33 ICP footer pages should remain discoverable.');
for (const file of icpHtmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  assert(html.includes('class="icp-link"'), `${file} should use the shared ICP interaction class.`);
  const normalizedFile = file.replace(/\\/g, '/');
  const expectedStyleVersion = unifiedNavPages.has(normalizedFile) ? '20260828' : '20260812';
  assert(
    new RegExp(`(?:\\.\\.\\/)*style\\.css\\?v=${expectedStyleVersion}(?:["'])`).test(html),
    `${file} should load stylesheet version ${expectedStyleVersion}.`
  );
}
assert(/\.icp-link\s*\{[^}]*cursor:\s*pointer[^}]*transition:\s*color 0\.2s ease, transform 0\.2s ease, text-decoration-color 0\.2s ease/s.test(css), 'ICP link should expose a pointer and explicit transitions.');
assert(/\.icp-link:hover\s*\{[^}]*color:\s*var\(--primary-color\)[^}]*text-decoration:\s*underline[^}]*transform:\s*translateY\(-1px\)/s.test(css), 'ICP link should visibly respond to pointer hover.');
assert(/\.icp-link:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--primary-color\)[^}]*outline-offset:\s*3px/s.test(css), 'ICP link should expose a visible keyboard focus state.');
assert(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.icp-link\s*\{[^}]*transition:\s*none[^}]*\}[\s\S]*?\.icp-link:hover\s*\{[^}]*transform:\s*none/s.test(css), 'ICP link motion should be disabled when reduced motion is requested.');

assert.ok(script.includes("entry.textContent = isEnglish ? 'Lxue GEO Workbench' : '零雪 GEO 程序'"), 'private workbench entry should translate the current product name in both languages.');
assert.ok(script.includes("localStorage.getItem('lang')"), 'private workbench entry should use the shared language key.');
assert.ok(script.includes('updateGeoWorkbenchEntry'), 'script.js should update the private workbench entry after language changes.');
assert.ok(script.includes("entry.href = 'https://geo.lxue.xin/'"), 'private workbench entry should use the dedicated GEO domain.');
assert.ok(!script.includes('updateCrawlerConsoleEntry'), 'retired crawler console entry must not return.');
assert.ok(
  /\.geo-workbench-entry\s*\{[^}]*display:\s*flex[^}]*width:\s*fit-content[^}]*margin:\s*16px auto 0/s.test(css),
  'private workbench footer entry should have a dedicated 16px top gap and remain centered.'
);

const context = {
  console,
  localStorage: { setItem() {}, getItem() { return null; } },
  document: {
    documentElement: { lang: 'zh-CN', setAttribute() {} },
    querySelectorAll(selector) {
      if (selector === '[data-i18n]') return [footerBrand, footerDesc, footerIcp, recentTitle, heroPrefix, navHome];
      if (selector === '[data-i18n-placeholder]') return [];
      if (selector === '.lang-switch, .lang-switch-mobile') return [langButton];
      return [];
    },
    addEventListener() {}
  }
};

vm.createContext(context);
vm.runInContext(fs.readFileSync('i18n.js', 'utf8'), context);
context.i18n.switchLang('en');

assert.equal(navHome.textContent, 'Home', 'navigation should translate to English.');
assert.equal(footerBrand.textContent, 'Lingxue AI GEO Optimization', 'footer brand should translate to English.');
assert.equal(footerDesc.textContent, 'Focused on GEO optimization, rebuilding enterprise traffic with AI', 'footer description should translate to English.');
assert.equal(footerIcp.textContent, 'ICP: 粤ICP备2026018563号', 'ICP label should translate in English mode.');
assert.equal(recentTitle.textContent, 'Recent Articles', 'recent article heading should translate to English.');
assert.equal(heroPrefix.textContent, 'Recommended: ', 'AI recommendation prefix should translate to English.');

console.log('Footer and shared i18n validation passed.');
