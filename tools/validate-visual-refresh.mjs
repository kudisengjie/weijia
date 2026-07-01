import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('style.css', 'utf8');
const js = fs.readFileSync('script.js', 'utf8');

const cssRequirements = [
  ['--ai-accent', 'visual refresh should define a secondary AI accent color'],
  ['.hero-ai-demo::before', 'hero AI demo should have an animated semantic field layer'],
  ['.hero-ai-demo::after', 'hero AI demo should include floating AI nodes'],
  ['@keyframes aiSignalFlow', 'visual refresh should animate AI signal flow'],
  ['@keyframes neuralNodePulse', 'visual refresh should animate neural nodes'],
  ['@keyframes cardSignalSweep', 'cards should have subtle signal sweep animation'],
  ['.visual-motion-ready .section', 'sections should gain dynamic entrance state'],
  ['.motion-reveal.motion-visible', 'scroll reveal should have a visible state'],
  ['.ai-chat-window::after', 'AI chat window should include a scanning highlight'],
  ['.home-card-pro::after', 'home cards should include AI-related patterning'],
  ['.profile-content-block::after', 'profile blocks should include AI node patterning'],
  ['.recent-article-item::after', 'recent article rows should include hover motion detail'],
  ['@media (prefers-reduced-motion: reduce)', 'motion must respect reduced-motion preferences'],
  ['@media (max-width: 768px)', 'visual refresh must include mobile-specific handling']
];

for (const [needle, message] of cssRequirements) {
  assert.ok(css.includes(needle), message);
}

const jsRequirements = [
  ['initVisualRefreshMotion', 'script.js should initialize visual refresh motion'],
  ['matchMedia(\'(prefers-reduced-motion: reduce)\')', 'script.js should respect reduced-motion before adding motion'],
  ['--ai-pointer-x', 'script.js should drive subtle pointer-based AI parallax'],
  ['motion-reveal', 'script.js should add motion reveal classes without changing content'],
  ['IntersectionObserver', 'script.js should use viewport-based reveal animation']
];

for (const [needle, message] of jsRequirements) {
  assert.ok(js.includes(needle), message);
}

assert.ok(!css.includes('scale(1.2)'), 'visual refresh should avoid aggressive scaling that can break mobile layout.');
assert.ok(!js.includes('innerHTML ='), 'new motion code should not rewrite page content with innerHTML.');

console.log('Visual refresh validation passed.');
