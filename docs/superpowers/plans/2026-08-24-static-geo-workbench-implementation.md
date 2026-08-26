# Static Lxue GEO Workbench Implementation Plan

**Goal:** Publish a self-contained, local-file-reading preview at `https://geo.lxue.xin/` without connecting any generation backend.

**Architecture:** `geo-site/index.html` owns the accessible structure, `styles.css` owns the isolated visual system, `src/app.js` owns local parsing, and `assets/app.js` is the committed browser bundle. EdgeOne deploys `geo-site` as a separate project root.

## Task 1: Lock the contract with a failing validator

- [x] Add `tools/validate-static-geo-workbench.mjs`.
- [x] Require the dedicated site directory, final domain, file previews, disabled run control, security headers, and absence of IMA/DeepSeek endpoints.
- [x] Run it before implementation and confirm the missing-site failure.

## Task 2: Build local-only file reading

- [x] Add the four-step workbench, functional navigation views, empty states and complete IP image.
- [x] Parse XLSX/XLS/CSV into a bounded table preview.
- [x] Parse DOCX, text PDF, TXT, MD, RTF and ODT into bounded plain-text previews.
- [x] Treat legacy DOC as unsupported instead of reporting false success.
- [x] Keep generation, IMA and DeepSeek controls visibly disconnected and disabled.

## Task 3: Isolate deployment and browser security

- [x] Keep the official footer entry on `https://geo.lxue.xin/`.
- [x] Add a dedicated `geo-site/edgeone.json` with `connect-src 'none'` and static security headers.
- [x] Bundle dependencies and the PDF worker locally; do not use a runtime CDN.

## Task 4: Verify and publish

- [x] Pass the focused static validator and existing footer validators.
- [x] Use official Google Chrome to read the real task workbook and a real DOCX without console errors or external requests.
- [x] Pass all existing website validators and repeat desktop/mobile overflow checks.
- [ ] Commit only intended files, push `master`, and verify the remote commit.
- [ ] Create/update a dedicated EdgeOne Pages project with root directory `geo-site` and bind `geo.lxue.xin`.
