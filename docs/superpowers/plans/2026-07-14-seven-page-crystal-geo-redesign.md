# Seven-Page Crystal GEO Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the existing static GEO website as the approved seven-page bright crystal experience while preserving content, crawlability, article URLs, accessibility, and rollback safety.

**Architecture:** Keep the multi-page static HTML architecture. Add a small Vite build layer, shared CSS/JavaScript modules, progressive Three.js/GSAP enhancement, URL-backed interaction state, and static fallbacks. Apply the shared system to the home, profile, blog, guide, strategy, support, article, and brand-facts templates without moving core text into Canvas.

**Tech Stack:** HTML5, CSS custom properties, JavaScript ES modules, Vite, Three.js, GSAP/ScrollTrigger, Vitest, jsdom, Playwright, Sharp, existing Node validators, Figma plugin.

---

## File map

### Build and tests

- Create `package.json`: scripts and dependency contract.
- Create `package-lock.json`: locked dependency graph.
- Create `vite.config.mjs`: multi-page build entries and static output.
- Create `vitest.config.mjs`: jsdom unit-test environment.
- Create `playwright.config.mjs`: desktop and mobile browser projects.
- Create `tests/site-contract.test.mjs`: static markup and route requirements.
- Create `tests/motion-gate.test.mjs`: deterministic motion-tier rules.
- Create `tests/blog-filter.test.mjs`: blog filtering and URL-state rules.
- Create `tests/platform-tabs.test.mjs`: strategy tab state and keyboard rules.
- Create `tests/faq-search.test.mjs`: FAQ search and accordion rules.
- Create `tests/reading-progress.test.mjs`: article heading and progress rules.
- Create `tests/avatar-asset.test.mjs`: avatar dimensions, transparency, and fallbacks.
- Create `tests/e2e/crystal-site.spec.mjs`: navigation, interaction, and responsive checks.
- Create `tools/validate-crystal-redesign.mjs`: production static contract validator.
- Create `tools/optimize-visual-assets.mjs`: deterministic avatar derivatives.

### Shared runtime

- Create `src/styles/tokens.css`: color, spacing, type, surface, and motion variables.
- Create `src/styles/base.css`: reset, typography, containers, focus, and reduced motion.
- Create `src/styles/components.css`: nav, buttons, glass cards, lists, tabs, FAQ, CTA.
- Create `src/styles/motion.css`: entry, hover, shimmer, and route-transition classes.
- Create `src/styles/crystal-site.css`: import manifest for shared styles.
- Create `src/styles/pages/home.css`: home composition.
- Create `src/styles/pages/profile.css`: profile and robot composition.
- Create `src/styles/pages/blog.css`: blog directory and filters.
- Create `src/styles/pages/guide.css`: guide cards, comparison, and chapter rail.
- Create `src/styles/pages/strategy.css`: platform tabs, matrix, and timeline.
- Create `src/styles/pages/support.css`: FAQ search, groups, and consultation.
- Create `src/styles/pages/article.css`: article header, progress, body, and TOC.
- Create `src/scripts/main.js`: shared bootstrap.
- Create `src/scripts/core/motion-gate.js`: feature and preference classification.
- Create `src/scripts/core/navigation.js`: mobile navigation and active state.
- Create `src/scripts/core/reveal.js`: IntersectionObserver entry behavior.
- Create `src/scripts/core/page-transitions.js`: progressive link feedback.
- Create `src/scripts/scenes/crystal-scene.js`: optional Three.js hero scene.
- Create `src/scripts/components/blog-filter.js`: filtering and URL state.
- Create `src/scripts/components/platform-tabs.js`: platform selection and URL state.
- Create `src/scripts/components/faq-search.js`: search, category, and accordion state.
- Create `src/scripts/components/reading-progress.js`: TOC and reading progress.
- Create `src/scripts/components/robot-avatar.js`: preview dialog and avatar motion.

### Existing pages

- Modify `index.html`: approved home composition.
- Modify `profile.html`: approved profile composition and new avatar.
- Modify `blog/index.html`: article directory composition.
- Create `articles/geo-compliance-industry-standards-2026.html`: preserved blog essay 1.
- Create `articles/ai-search-algorithm-trust-update-2026.html`: preserved blog essay 2.
- Create `articles/geo-3-brand-asset-strategy.html`: preserved blog essay 3.
- Create `articles/ai-platform-indexing-logic-comparison.html`: preserved blog essay 4.
- Create `articles/geo-common-mistakes-blog.html`: preserved blog essay 5.
- Modify `geo-guide.html`: guide composition.
- Modify `insights.html`: strategy center composition.
- Modify `support.html`: searchable FAQ composition.
- Modify `brand-facts.html`: shared shell without WebGL.
- Modify `articles/*.html`: shared article detail enhancement.
- Modify `i18n.js`: labels introduced by the new UI.
- Modify `sitemap.xml`, `sitemap-articles.xml`, and `llms.txt` only if route validation identifies omissions.
- Preserve `admin/**`, `crawler-console.html`, article canonical URLs, and existing factual text.

### Assets

- Create `images/yirui-avatar-source.png`: exact 1254×1254 ARGB source supplied by the user.
- Create `images/yirui-avatar.webp`: optimized transparent fallback.
- Create `images/yirui-avatar.avif`: preferred optimized transparent format.
- Create `images/crystal-fallback.webp`: static no-WebGL hero fallback.
- Do not commit the seven 1491×1055 reference composites.

## Task 1: Establish the test and build contract

**Files:**
- Create: `package.json`
- Create: `vite.config.mjs`
- Create: `vitest.config.mjs`
- Create: `tests/site-contract.test.mjs`
- Create: `tools/validate-crystal-redesign.mjs`

- [ ] **Step 1: Write the failing static contract test**

Create `tests/site-contract.test.mjs` with route, asset, semantic-link, and canvas-text assertions:

```js
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const routes = [
  'index.html',
  'profile.html',
  'blog/index.html',
  'geo-guide.html',
  'insights.html',
  'support.html',
  'brand-facts.html'
];

describe('crystal site contract', () => {
  test.each(routes)('%s loads shared crystal assets', (route) => {
    const html = readFileSync(route, 'utf8');
    expect(html).toContain('src/styles/crystal-site.css');
    expect(html).toContain('src/scripts/main.js');
    expect(html).toMatch(/<a\s[^>]*href=/);
  });

  test('home exposes the seven user routes as real links', () => {
    const html = readFileSync('index.html', 'utf8');
    for (const href of ['profile.html', 'blog/index.html', 'geo-guide.html', 'insights.html', 'support.html']) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  test('canvas is decorative', () => {
    const html = routes.map((route) => readFileSync(route, 'utf8')).join('\n');
    expect(html).not.toMatch(/<canvas[^>]*>[^<\s]+/);
  });
});
```

- [ ] **Step 2: Run the test and confirm the expected failure**

Run: `npm test -- tests/site-contract.test.mjs`

Expected: FAIL because `package.json` and shared crystal asset references do not exist.

- [ ] **Step 3: Add the build configuration**

Create `package.json` with scripts:

```json
{
  "name": "weijia-crystal-geo-site",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:static": "node tools/validate-crystal-redesign.mjs",
    "test:e2e": "playwright test",
    "assets": "node tools/optimize-visual-assets.mjs",
    "check": "npm test && npm run test:static && npm run build"
  },
  "dependencies": {
    "gsap": "^3.13.0",
    "three": "^0.178.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.54.0",
    "jsdom": "^26.1.0",
    "sharp": "^0.34.3",
    "vite": "^7.0.0",
    "vitest": "^3.2.4"
  }
}
```

Create `vite.config.mjs` by gathering the root pages, `blog/index.html`, and all `articles/*.html` as Rollup inputs. Set `build.outDir` to `dist`, `emptyOutDir` to true, and `base` to `/`.

Create `vitest.config.mjs` with `environment: 'jsdom'`, `restoreMocks: true`, and `clearMocks: true`.

- [ ] **Step 4: Add the production validator entry point**

Create `tools/validate-crystal-redesign.mjs` to read the seven route files, verify shared CSS/JS references, ensure every route has a canonical link and H1, ensure no `javascript:` links exist, and exit non-zero with one line per violation.

- [ ] **Step 5: Install dependencies and record the lockfile**

Run: `npm install`

Expected: `package-lock.json` is created and npm exits 0.

- [ ] **Step 6: Commit the foundation**

```powershell
git add package.json package-lock.json vite.config.mjs vitest.config.mjs tests/site-contract.test.mjs tools/validate-crystal-redesign.mjs
git commit -m "build: add crystal site test and build foundation"
```

## Task 2: Add and validate the supplied robot avatar

**Files:**
- Create: `images/yirui-avatar-source.png`
- Create: `images/yirui-avatar.webp`
- Create: `images/yirui-avatar.avif`
- Create: `tools/optimize-visual-assets.mjs`
- Create: `tests/avatar-asset.test.mjs`

- [ ] **Step 1: Write the failing asset test**

Use Sharp metadata to assert that the source is exactly 1254×1254, contains alpha, and both derivatives contain alpha and remain square.

```js
import { describe, expect, test } from 'vitest';
import sharp from 'sharp';

describe('profile avatar assets', () => {
  test('keeps the supplied transparent source', async () => {
    const metadata = await sharp('images/yirui-avatar-source.png').metadata();
    expect(metadata.width).toBe(1254);
    expect(metadata.height).toBe(1254);
    expect(metadata.hasAlpha).toBe(true);
  });

  test.each(['images/yirui-avatar.webp', 'images/yirui-avatar.avif'])('%s preserves alpha', async (file) => {
    const metadata = await sharp(file).metadata();
    expect(metadata.width).toBe(metadata.height);
    expect(metadata.hasAlpha).toBe(true);
  });
});
```

- [ ] **Step 2: Run the asset test and confirm it fails**

Run: `npm test -- tests/avatar-asset.test.mjs`

Expected: FAIL because the new source and derivatives are absent.

- [ ] **Step 3: Copy the exact source and create deterministic derivatives**

Copy `E:\图片\奕蕊机器人\表情包\01_meiwenti_transparent.png` to `images/yirui-avatar-source.png` and verify SHA-256 remains `76981385FE2AF468650E9B6D8363698DA9EED0271A21824CEC8C67781769AF90`.

Create `tools/optimize-visual-assets.mjs` that loads the source once and writes a lossless WebP and an AVIF with quality 62 and effort 6. Do not crop or regenerate the supplied character.

- [ ] **Step 4: Generate and verify the assets**

Run: `npm run assets && npm test -- tests/avatar-asset.test.mjs`

Expected: both commands exit 0 and all avatar tests pass.

- [ ] **Step 5: Commit the asset pipeline**

```powershell
git add images/yirui-avatar-source.png images/yirui-avatar.webp images/yirui-avatar.avif tools/optimize-visual-assets.mjs tests/avatar-asset.test.mjs
git commit -m "feat: add supplied robot avatar assets"
```

## Task 3: Build the shared visual foundation

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/base.css`
- Create: `src/styles/components.css`
- Create: `src/styles/motion.css`
- Create: `src/styles/crystal-site.css`
- Modify: `index.html`, `profile.html`, `blog/index.html`, `geo-guide.html`, `insights.html`, `support.html`, `brand-facts.html`

- [ ] **Step 1: Extend the failing contract for tokens and focus states**

Add assertions that `tokens.css` contains `--crystal-blue: #2168ff`, `--crystal-bg: #f7faff`, and that `base.css` contains `:focus-visible` plus `prefers-reduced-motion`.

- [ ] **Step 2: Run the contract test and confirm failure**

Run: `npm test -- tests/site-contract.test.mjs`

Expected: FAIL because the style modules do not exist.

- [ ] **Step 3: Implement tokens and base rules**

Define the approved color, type, spacing, radius, shadow, blur, z-index, and duration tokens. Add box sizing, body typography, 1200px container, accessible skip link, focus rings, responsive type scaling, and reduced-motion overrides.

- [ ] **Step 4: Implement reusable components**

Add `.crystal-nav`, `.glass-card`, `.crystal-button`, `.stat-card`, `.article-row`, `.platform-tabs`, `.faq-item`, `.consult-panel`, `.crystal-hero`, and `.crystal-fallback` rules. Keep existing class names as compatibility selectors during migration.

- [ ] **Step 5: Add shared styles to the seven routes**

Place `<link rel="stylesheet" href=".../src/styles/crystal-site.css">` after the existing stylesheet, using `../` only for `blog/index.html`. Add `data-crystal-page` to `<body>` with values `home`, `profile`, `blog`, `guide`, `strategy`, `support`, and `facts`.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/site-contract.test.mjs && npm run test:static`

Expected: both commands exit 0.

Run `git add src/styles index.html profile.html blog/index.html geo-guide.html insights.html support.html brand-facts.html tests/site-contract.test.mjs`, then commit with `git commit -m "feat: add crystal visual foundation"`.

## Task 4: Implement motion gating and shared runtime

**Files:**
- Create: `src/scripts/main.js`
- Create: `src/scripts/core/motion-gate.js`
- Create: `src/scripts/core/navigation.js`
- Create: `src/scripts/core/reveal.js`
- Create: `src/scripts/core/page-transitions.js`
- Create: `tests/motion-gate.test.mjs`
- Modify: seven route files

- [ ] **Step 1: Write failing motion-tier tests**

Test a pure `getMotionTier()` function with these outcomes: reduced motion returns `static`; no WebGL returns `static`; mobile with four or fewer logical cores returns `lite`; capable mobile returns `standard`; desktop with eight cores returns `flagship`.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/motion-gate.test.mjs`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the pure classifier and runtime guard**

Export `getMotionTier({ reducedMotion, hasWebGL, mobile, cores })`. Add `detectMotionTier(window)` and set `document.documentElement.dataset.motionTier` before starting animation modules.

- [ ] **Step 4: Implement navigation, reveal, and link feedback**

Navigation controls the existing menu button, applies `aria-expanded`, and closes on Escape. Reveal observes `[data-reveal]`, adds `is-visible` once, and reveals immediately in static mode. Page transitions add a short visual class to same-origin HTML links but never prevent modified clicks, downloads, hash links, or new tabs.

- [ ] **Step 5: Add the shared module entry**

Add `<script type="module" src=".../src/scripts/main.js"></script>` to the seven routes. `main.js` selects modules by `data-crystal-page` and catches enhancement errors without hiding content.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/motion-gate.test.mjs tests/site-contract.test.mjs`

Expected: PASS.

Commit: `git commit -m "feat: add progressive crystal motion runtime"`.

## Task 5: Implement the optional 3D crystal scene

**Files:**
- Create: `src/scripts/scenes/crystal-scene.js`
- Create: `src/styles/pages/home.css`
- Create: `images/crystal-fallback.webp`
- Modify: `src/scripts/main.js`
- Modify: `index.html`

- [ ] **Step 1: Add a failing home-scene contract**

Assert that home contains a decorative container with `data-crystal-scene`, an accessible fallback image, and no user-facing text inside the canvas host.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/site-contract.test.mjs`

Expected: FAIL because the home scene host is absent.

- [ ] **Step 3: Implement the scene**

Create a transparent refractive rounded crystal with an internal `AI` glyph represented by geometry, three low-poly satellite shards, environment lighting, capped DPR, pointer parallax capped at 12px, visibility pause, and resize cleanup. Cap draw calls at 40 and disable particles outside flagship mode. Extend `tools/optimize-visual-assets.mjs` to render a deterministic 1600×1000 SVG crystal composition through Sharp and write `images/crystal-fallback.webp` at quality 82.

- [ ] **Step 4: Implement fallback behavior**

If tier is static or scene creation throws, leave the fallback `<picture>` visible. If the scene starts, fade the fallback after the first rendered frame. Never remove the fallback from the DOM.

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run build`

Expected: tests pass and Vite builds without unresolved Three.js imports.

Commit: `git commit -m "feat: add adaptive 3d crystal hero"`.

## Task 6: Rebuild the home page from reference image 6

**Files:**
- Modify: `index.html`
- Create: `src/styles/pages/home.css`
- Modify: `src/styles/crystal-site.css`
- Modify: `i18n.js`
- Extend: `tests/site-contract.test.mjs`

- [ ] **Step 1: Write failing home composition assertions**

Require `data-home-hero`, `data-home-stats`, `data-home-articles`, `data-platform-entry`, `data-prime-timeline`, and `data-consult-panel`. Assert that recent article entries and platform entries are anchors.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/site-contract.test.mjs`

Expected: FAIL on missing home sections.

- [ ] **Step 3: Replace the home composition without changing facts**

Use the current hero claim, real stats, existing article links, existing platform topics, existing P.R.I.M.E descriptions, and current consultation details. Build the approved left-copy/right-crystal hero, compact stat strip, title-only article panel, platform cards, five-step method cards, and consultation band.

- [ ] **Step 4: Add motion annotations and translations**

Mark only visible cards with `data-reveal` and stagger indices. Add new UI labels to both Chinese and English branches in `i18n.js`. Do not translate URLs or structured data.

- [ ] **Step 5: Verify home at three viewports**

Run the dev server and inspect 1440×1000, 768×1024, and 375×812. Confirm no horizontal overflow, no clipped CTA, and fallback content before JavaScript.

- [ ] **Step 6: Commit**

Commit: `git commit -m "feat: rebuild crystal GEO home page"`.

## Task 7: Rebuild the profile page and robot avatar

**Files:**
- Modify: `profile.html`
- Create: `src/styles/pages/profile.css`
- Create: `src/scripts/components/robot-avatar.js`
- Modify: `src/scripts/main.js`
- Modify: `i18n.js`
- Extend: `tests/avatar-asset.test.mjs`

- [ ] **Step 1: Write failing profile-avatar markup tests**

Assert the profile page uses `<picture>` with AVIF, WebP, and PNG; the image alt equals `炜佳导 GEO 的机器人形象，戴牛仔帽并竖起大拇指`; the preview control has `aria-haspopup="dialog"`; and `.prime-block` has `id="prime"`.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/avatar-asset.test.mjs`

Expected: FAIL because the profile still uses its old layout.

- [ ] **Step 3: Recompose the page**

Build the approved split hero, identity card, “我是谁” block, capability tags, P.R.I.M.E timeline, service process, platform topics, and consultation band. Preserve all existing factual paragraphs and tables below the redesigned summaries.

- [ ] **Step 4: Implement avatar behavior**

Use CSS object positioning for the desktop and mobile crop. `robot-avatar.js` opens a native `<dialog>` containing the complete source image, traps focus through the native dialog behavior, closes on Escape or backdrop click, and returns focus to the trigger.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- tests/avatar-asset.test.mjs tests/site-contract.test.mjs && npm run build`

Expected: PASS.

Commit: `git commit -m "feat: rebuild profile with supplied robot avatar"`.

## Task 8: Convert the blog into a searchable article directory

**Files:**
- Modify: `blog/index.html`
- Create: `src/styles/pages/blog.css`
- Create: `src/scripts/components/blog-filter.js`
- Create: `tests/blog-filter.test.mjs`
- Modify: `src/scripts/main.js`

- [ ] **Step 1: Write failing filter tests**

Test `filterArticles(items, { query, tag, range })` with case-insensitive title matches, tag matches, all-time behavior, and stable original ordering. Test `readBlogState(URLSearchParams)` defaults and serialization.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/blog-filter.test.mjs`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Rebuild the directory**

Create the BLOG hero, category rail, filter drawer, title-only article rows for all existing standalone articles, topic cards, load-more control, empty state, and consultation CTA. Move the five current long essays without rewriting their body content into `articles/geo-compliance-industry-standards-2026.html`, `articles/ai-search-algorithm-trust-update-2026.html`, `articles/geo-3-brand-asset-strategy.html`, `articles/ai-platform-indexing-logic-comparison.html`, and `articles/geo-common-mistakes-blog.html`. Replace each index essay with a title row linking to its new page. Keep the “One More Thing” block as the blog consultation preface.

- [ ] **Step 4: Implement URL-backed filtering**

Use `q`, `tag`, and `range` query parameters. Update results with `history.replaceState`, announce counts through `aria-live`, and keep the active element stable after filtering.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- tests/blog-filter.test.mjs tests/site-contract.test.mjs && npm run build`

Expected: PASS.

Commit: `git commit -m "feat: rebuild blog as article directory"`.

## Task 9: Rebuild the GEO guide from reference image 1

**Files:**
- Modify: `geo-guide.html`
- Create: `src/styles/pages/guide.css`
- Modify: `src/scripts/main.js`
- Extend: `tests/site-contract.test.mjs`

- [ ] **Step 1: Add failing guide assertions**

Require the guide hero, four principle cards, value section, GEO/SEO comparison, chapter navigation, related guides, and strategy CTA. Require chapter links to point to existing IDs.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/site-contract.test.mjs`

Expected: FAIL on the new guide contract.

- [ ] **Step 3: Recompose existing guide content**

Map existing principles and steps into the approved cards. Keep original paragraphs and tables. Add a sticky desktop chapter rail and mobile horizontal chapter list. Use CSS and shared reveal logic only; do not add a second 3D runtime.

- [ ] **Step 4: Verify and commit**

Run: `npm test && npm run build`.

Commit: `git commit -m "feat: rebuild crystal GEO guide"`.

## Task 10: Rebuild the strategy center with platform state

**Files:**
- Modify: `insights.html`
- Create: `src/styles/pages/strategy.css`
- Create: `src/scripts/components/platform-tabs.js`
- Create: `tests/platform-tabs.test.mjs`
- Modify: `src/scripts/main.js`

- [ ] **Step 1: Write failing platform state tests**

Test normalization of platform IDs, URL parsing, URL serialization, keyboard next/previous behavior, and fallback to the first enabled platform.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/platform-tabs.test.mjs`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Recompose real strategy content**

Build the compass hero, platform tab rail, adaptation matrix, title-only platform topics, P.R.I.M.E strategy path, and consultation band. Generate the visible platform count from existing content rather than the reference image.

- [ ] **Step 4: Implement accessible platform tabs**

Use `role="tablist"`, roving tabindex, Enter/Space activation, arrow navigation, `platform` query parameter, and session restoration. Switching updates only corresponding panels and never fetches core text.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- tests/platform-tabs.test.mjs tests/site-contract.test.mjs && npm run build`

Commit: `git commit -m "feat: rebuild GEO strategy center"`.

## Task 11: Rebuild FAQ search, groups, and consultation

**Files:**
- Modify: `support.html`
- Create: `src/styles/pages/support.css`
- Create: `src/scripts/components/faq-search.js`
- Create: `tests/faq-search.test.mjs`
- Modify: `src/scripts/main.js`

- [ ] **Step 1: Write failing FAQ tests**

Test normalized Chinese and English search, category selection, highlighted text escaping, single-open behavior, URL hash lookup, and zero-result behavior.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/faq-search.test.mjs`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Recompose all existing FAQ content**

Build the FAQ hero, search input, category rail, grouped accordion, consultation card, process strip, and related article titles. Keep every existing question and answer in initial HTML.

- [ ] **Step 4: Implement accessible search and accordion**

Use buttons with `aria-expanded`, panels with `aria-labelledby`, one open item per group, hash synchronization, search-result announcements, and automatic expansion of a hash-targeted question.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- tests/faq-search.test.mjs && node tools/validate-geo-accordion.mjs && npm run build`

Commit: `git commit -m "feat: rebuild searchable GEO FAQ"`.

## Task 12: Enhance all article detail pages

**Files:**
- Modify: the 23 existing `articles/*.html` files
- Modify: the five article files created in Task 8
- Create: `src/styles/pages/article.css`
- Create: `src/scripts/components/reading-progress.js`
- Create: `tests/reading-progress.test.mjs`
- Modify: `src/scripts/main.js`

- [ ] **Step 1: Write failing reading tests**

Test `slugifyHeading`, unique duplicate IDs, progress clamping from 0 to 1, active-heading selection, and TOC generation from H2/H3 elements.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/reading-progress.test.mjs`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Add the shared article shell**

Apply the crystal stylesheet and module script to all 28 article pages. Add a decorative article hero layer, progress bar, TOC container, related-title area, and consultation card without changing article body text, canonical URLs, JSON-LD, citations, or heading order.

- [ ] **Step 4: Implement progress and TOC**

Assign deterministic IDs only when missing, build nested TOC links, update `aria-current`, update a CSS progress variable with `requestAnimationFrame`, and stop observation on page hide.

- [ ] **Step 5: Verify all article pages and commit**

Run: `node tools/validate-recent-articles.mjs && node tools/validate-blog-word-articles.mjs && npm test -- tests/reading-progress.test.mjs && npm run build`

Expected: all validators and tests exit 0.

Commit: `git commit -m "feat: add crystal article reading experience"`.

## Task 13: Align brand facts, translations, and machine entry points

**Files:**
- Modify: `brand-facts.html`
- Modify: `i18n.js`
- Verify: `robots.txt`, `llms.txt`, `sitemap.xml`, `sitemap-articles.xml`
- Extend: `tools/validate-crystal-redesign.mjs`

- [ ] **Step 1: Add failing machine-entry assertions**

Require brand facts to use the shared shell without `data-crystal-scene`; require all article canonical URLs to appear in the article Sitemap; require `llms.txt` to link to brand facts, guide, strategy, FAQ, and blog.

- [ ] **Step 2: Run and confirm any actual gaps**

Run: `npm run test:static`

Expected: FAIL only for missing redesigned references. If an existing machine file already passes a requirement, leave it unchanged.

- [ ] **Step 3: Apply the shared shell and complete translations**

Keep brand-facts content plain and machine readable. Add only labels introduced by the redesign to `i18n.js`. Preserve existing brand entity facts and contact data.

- [ ] **Step 4: Verify and commit**

Run every existing Node validator followed by `npm run test:static`.

Expected: all commands exit 0.

Commit: `git commit -m "feat: align crystal UI with GEO machine entry points"`.

## Task 14: Add Playwright responsive and interaction coverage

**Files:**
- Create: `playwright.config.mjs`
- Create: `tests/e2e/crystal-site.spec.mjs`

- [ ] **Step 1: Write failing browser tests**

Cover home navigation, profile avatar dialog, blog filtering, platform tabs, FAQ deep link, article TOC, no horizontal overflow, reduced motion, and JavaScript-disabled access.

- [ ] **Step 2: Run and confirm failures against incomplete pages**

Run: `npm run dev` in one terminal and `npm run test:e2e` in another.

Expected: tests identify any remaining route, selector, or interaction failures.

- [ ] **Step 3: Fix only observed failures**

Adjust the responsible page, component, or style module. Do not weaken assertions to match broken behavior.

- [ ] **Step 4: Run desktop and mobile projects**

Configure Chromium desktop 1440×1000 and mobile 375×812. Run the full suite and confirm zero failures.

- [ ] **Step 5: Commit**

Commit: `git commit -m "test: cover crystal site interactions and viewports"`.

## Task 15: Enforce performance and accessibility budgets

**Files:**
- Modify: `vite.config.mjs`
- Modify: `src/scripts/scenes/crystal-scene.js`
- Modify: `src/scripts/main.js`
- Modify: `src/styles/components.css`
- Modify: `src/styles/motion.css`
- Modify: `src/styles/pages/home.css`
- Modify: `src/styles/pages/profile.css`
- Modify: `src/styles/pages/article.css`
- Modify: `tools/optimize-visual-assets.mjs`
- Modify: `tools/validate-crystal-redesign.mjs`
- Modify: `tests/e2e/crystal-site.spec.mjs`
- Extend: `tools/validate-crystal-redesign.mjs`

- [ ] **Step 1: Measure production output**

Run `npm run build`. Record gzipped home JS, inner-page JS, largest asset, and initial route transfer. Fail validation if home JS exceeds 220KB gzip, inner-page JS exceeds 65KB gzip, or a hero asset exceeds the approved budget.

- [ ] **Step 2: Measure runtime behavior**

Use Playwright performance entries to assert no layout shift caused by late image sizing, no long task above 200ms during initial interaction, and that the 3D loop pauses when the page becomes hidden.

- [ ] **Step 3: Verify accessibility modes**

Run keyboard-only flows, 200% zoom, `prefers-reduced-motion`, forced no-WebGL, and JavaScript-disabled snapshots. Confirm focus visibility and complete content.

- [ ] **Step 4: Optimize measured bottlenecks**

Apply code splitting, lower DPR, fewer particles, smaller derivatives, explicit image dimensions, and deferred scene import only where measurements show a budget violation.

- [ ] **Step 5: Commit**

Commit: `git commit -m "perf: enforce crystal site budgets and fallbacks"`.

## Task 16: Create and connect the Figma handoff file

**Files:**
- No repository source changes unless Code Connect metadata files are produced.
- Figma file: `炜佳导 GEO 官网 2026 动态改版`

- [ ] **Step 1: Recheck Figma connector state**

Call Figma `whoami`. If it still returns the same remote MCP transport error, report the external blocker and do not guess a plan key.

- [ ] **Step 2: Create the design file after authentication succeeds**

Load the required Figma create-file guidance, use the only authenticated plan automatically or ask when multiple plans exist, and create a design file with the approved name.

- [ ] **Step 3: Build the design system and pages**

Create the 13 approved Figma pages, variables, components, seven desktop screens, required 768px and 375px states, prototype interactions, and Handoff annotations.

- [ ] **Step 4: Capture implemented pages and refine**

Use the local Vite URLs to capture each implemented page into the Figma file. Compare the editable component screens with captures, refine spacing and proportions, then remove temporary capture-only frames.

- [ ] **Step 5: Add Code Connect mappings**

Map Nav, GlassCard, Button, ArticleRow, PlatformTabs, FAQItem, PrimeTimeline, ConsultPanel, and RobotAvatar nodes to the relevant `src` files using the `Javascript` label.

- [ ] **Step 6: Record the Figma URL in project documentation**

Add the final node-specific URLs to a short handoff section in the design spec and commit only that documentation change.

## Task 17: Final verification, GitHub push, and handoff

**Files:**
- Verify all changed files.
- Update documentation only with measured final values and Figma links.

- [ ] **Step 1: Run the complete local verification**

Run:

```powershell
npm run check
node tools/validate-ai-index-center.mjs
node tools/validate-ai-platform-admin.mjs
node tools/validate-blog-word-articles.mjs
node tools/validate-footer-i18n.mjs
node tools/validate-geo-accordion.mjs
node tools/validate-recent-articles.mjs
node tools/validate-requested-fixes.mjs
node tools/validate-site-content-consistency.mjs
node tools/validate-static-layout-restore.mjs
node tools/test-crawler-classifier.mjs
npm run test:e2e
```

Expected: every command exits 0 with zero failed tests.

- [ ] **Step 2: Review the final diff and repository hygiene**

Run `git status --short`, `git diff --check`, `git diff --stat master...HEAD`, and search for secrets, temporary reference images, debug logs, and localhost production links.

Expected: only intended source, tests, optimized assets, and documentation remain.

- [ ] **Step 3: Record final measured values and create the release documentation commit**

Update the design spec with the final Figma URL, measured bundle sizes, tested viewports, and verified performance values. Stage only that documentation update and commit with `git commit -m "docs: record crystal site release evidence"`. Do not amend unrelated user commits.

- [ ] **Step 4: Push the verified branch**

Run `git push -u origin <feature-branch>`.

Expected: GitHub reports the new branch and the local HEAD matches the remote branch SHA.

- [ ] **Step 5: Provide handoff evidence**

Report the branch, final commit SHA, GitHub URL, Figma URL, test totals, performance measurements, known external limitations, and rollback commit.
