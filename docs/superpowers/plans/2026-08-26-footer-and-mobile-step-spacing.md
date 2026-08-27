# Footer & Mobile Step Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase the desktop footer clearance around the GEO workbench link and prevent the four mobile GEO workflow steps from being visually compressed.

**Architecture:** Keep the existing HTML and JavaScript unchanged. Add narrowly scoped CSS rules to the shared website footer and the standalone GEO page, backed by source-level layout validation and desktop/mobile browser checks.

**Tech Stack:** Static HTML, CSS, JavaScript, Node.js validation scripts, Google Chrome.

---

### Task 1: Encode the two responsive layout requirements

**Files:**
- Modify: `tools/validate-footer-i18n.mjs`
- Modify: `tools/validate-static-geo-workbench.mjs`

- [ ] **Step 1: Write the failing tests**

Add assertions requiring `.geo-workbench-entry` to have its own top margin and requiring the `520px` GEO breakpoint to render `.geo-steps` as a two-column grid with readable step sizing.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tools/validate-footer-i18n.mjs` and `node tools/validate-static-geo-workbench.mjs`

Expected: both validators fail on the new spacing requirements.

### Task 2: Implement the minimal CSS fixes

**Files:**
- Modify: `style.css`
- Modify: `geo-site/styles.css`

- [ ] **Step 1: Increase footer link clearance**

Give `.geo-workbench-entry` a block-start margin while retaining its pill styling and focus/hover states.

- [ ] **Step 2: Preserve readable mobile workflow steps**

At `max-width: 520px`, use `repeat(2, minmax(0, 1fr))`, restore readable number-circle and label sizes, and keep each card at a stable minimum height.

- [ ] **Step 3: Run validators**

Run: `node tools/validate-footer-i18n.mjs` and `node tools/validate-static-geo-workbench.mjs`

Expected: both validators pass.

- [ ] **Step 4: Run the full website validation suite**

Run every tracked `tools/validate-*.mjs` script.

Expected: all validators pass.

- [ ] **Step 5: Verify in official Google Chrome**

Check the homepage footer at desktop width and the GEO page at a mobile width. Confirm the footer link has visible separation and all four workflow steps remain fully legible without horizontal scrolling.

- [ ] **Step 6: Commit and push**

Commit only the plan, validators, and two CSS files, then push `master` to the official `weijia` GitHub repository.
