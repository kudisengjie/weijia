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

const footerBrand = makeElement('footer.brand', '炜佳导导 GEO优化', true);
const footerDesc = makeElement('footer.desc', '专注GEO优化，用AI重塑企业流量架构', true);
const footerIcp = makeElement('footer.icp', '粤ICP备2026018563号', true);
const recentTitle = makeElement('recent.title', '近期文章', false);
const heroPrefix = makeElement('hero.ai.answer.prefix', '为您推荐：', false);
const navHome = makeElement('nav.home', '首页', false);
const langButton = { textContent: 'English', addEventListener() {} };

const script = fs.readFileSync('script.js', 'utf8');
assert.ok(script.includes("entry.textContent = isEnglish ? 'Data' : '\\u6570\\u636e'"), 'crawler console entry should translate to Data in English and data in Chinese.');
assert.ok(script.includes("localStorage.getItem('lang')"), 'crawler console entry should use the shared language key.');
assert.ok(script.includes('updateCrawlerConsoleEntry'), 'script.js should update crawler console entry after language changes.');

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
assert.equal(footerBrand.textContent, 'Weijia Daodao GEO Optimization', 'footer brand should translate to English.');
assert.equal(footerDesc.textContent, 'Focused on GEO optimization, rebuilding enterprise traffic with AI', 'footer description should translate to English.');
assert.equal(footerIcp.textContent, 'ICP: 粤ICP备2026018563号', 'ICP label should translate in English mode.');
assert.equal(recentTitle.textContent, 'Recent Articles', 'recent article heading should translate to English.');
assert.equal(heroPrefix.textContent, 'Recommended: ', 'AI recommendation prefix should translate to English.');

console.log('Footer and shared i18n validation passed.');
