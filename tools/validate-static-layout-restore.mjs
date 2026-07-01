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
assert.ok(css.includes('min-height: clamp(620px, 78vh, 760px);'), 'home hero should not occupy the full desktop viewport.');
assert.ok(css.includes('.hero-ai-demo {\n    flex: 0 1 420px;'), 'home AI demo should use the smaller restored desktop width.');

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
