import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('style.css', 'utf8');
const js = fs.readFileSync('script.js', 'utf8');

const removedCssArtifacts = [
  '2026 Dynamic AI Visual Refresh',
  'visual-motion-ready',
  '.hero-ai-demo::before',
  '.hero-ai-demo::after',
  '.home-card-pro::after',
  '.profile-content-block::after',
  '.recent-article-item::after',
  'cardSignalSweep',
  'neuralNodePulse',
  'aiSignalFlow'
];

for (const artifact of removedCssArtifacts) {
  assert.ok(!css.includes(artifact), `${artifact} should be removed to restore the pre-motion layout.`);
}

const removedJsArtifacts = [
  'initVisualRefreshMotion',
  'motion-reveal',
  '--ai-pointer-x',
  '--ai-pointer-y'
];

for (const artifact of removedJsArtifacts) {
  assert.ok(!js.includes(artifact), `${artifact} should be removed from script.js.`);
}

assert.ok(css.includes('@media (max-width: 768px)'), 'mobile responsive CSS should remain present.');
assert.ok(css.includes('.recent-article-list'), 'recent article layout should remain styled.');
assert.ok(css.includes('.ai-platform-card::after'), 'original AI platform card visual should remain available.');
assert.ok(css.includes('min-height: clamp(560px, 70vh, 680px);'), 'home hero should not occupy the full desktop viewport.');
assert.ok(css.includes('.hero-ai-demo {\n    flex: 0 1 340px;'), 'home AI demo should stay compact on desktop.');

const indexHtml = fs.readFileSync('index.html', 'utf8');
const i18n = fs.readFileSync('i18n.js', 'utf8');
for (const phrase of [
  '\u4e13\u6ce8GEO\u5b9e\u6218\u4e0eAI\u641c\u7d22\u53ef\u89c1\u5ea6\u63d0\u5347',
  '\u6c89\u6dc0\u884c\u4e1a\u95ee\u7b54\u3001\u54c1\u724c\u4e8b\u5b9e\u548c\u7ed3\u6784\u5316\u5185\u5bb9',
  '\u9002\u5408\u6559\u80b2\u79d1\u6280\u3001\u4f01\u4e1a\u670d\u52a1\u3001\u6d88\u8d39\u54c1\u7b49\u573a\u666f'
]) {
  assert.ok(indexHtml.includes(phrase) || i18n.includes(phrase), `home AI answer should include concise phrase: ${phrase}`);
}
const mobileMustKeep = [
  '.hero-container { flex-direction: column;',
  '.profile-layout { grid-template-columns: 1fr;',
  '.ai-platform-card-grid, .article-signal-grid, .article-process, .article-visual-note { grid-template-columns: 1fr;',
  '.recent-article-item { grid-template-columns: 36px minmax(0, 1fr) 52px;',
  '.footer-inner { flex-direction: column;'
];

for (const rule of mobileMustKeep) {
  assert.ok(css.includes(rule), `${rule} should remain for mobile responsiveness.`);
}

const adminCss = fs.readFileSync('admin/style.css', 'utf8');
assert.ok(adminCss.includes('html, body {'), 'admin page should clamp document overflow.');
assert.ok(adminCss.includes('width: min(1500px, 100%);'), 'admin login stage should not exceed the padded viewport.');
assert.ok(adminCss.includes('html[lang="en"] .hero-copy'), 'admin English login copy should have language-specific spacing.');
assert.ok(adminCss.includes('overflow-wrap: break-word;'), 'admin English title should wrap before it touches the login card.');

console.log('Static layout restore validation passed.');
