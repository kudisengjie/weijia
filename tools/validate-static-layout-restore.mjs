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

console.log('Static layout restore validation passed.');
