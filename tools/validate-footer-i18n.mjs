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
const navHome = makeElement('nav.home', '首页', false);
const langButton = { textContent: 'English', addEventListener() {} };

const context = {
  console,
  localStorage: { setItem() {}, getItem() { return null; } },
  document: {
    documentElement: { lang: 'zh-CN', setAttribute() {} },
    querySelectorAll(selector) {
      if (selector === '[data-i18n]') return [footerBrand, footerDesc, navHome];
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

assert.equal(navHome.textContent, 'Home', 'non-footer navigation should still translate to English.');
assert.equal(footerBrand.textContent, '炜佳导导 GEO优化', 'footer brand should stay Chinese in English mode.');
assert.equal(footerDesc.textContent, '专注GEO优化，用AI重塑企业流量架构', 'footer description should stay Chinese in English mode.');

console.log('Footer i18n layout validation passed.');