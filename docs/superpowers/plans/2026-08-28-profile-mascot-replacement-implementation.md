# Profile Mascot Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AI-platform heading robot with the user-provided ice elf as a clean transparent PNG while preserving the existing desktop and mobile layout.

**Architecture:** Produce one dedicated transparent image asset from the approved source, reference it from the existing `.ai-platform-robot` element, and keep the established responsive CSS sizing. Verify Alpha transparency, static-site contracts, and rendered desktop/mobile screenshots before pushing `master`.

**Tech Stack:** Static HTML/CSS, PNG Alpha transparency, ImageGen image editing with the user-approved local `rembg` fallback, Node.js validation scripts, Playwright CLI with a local Chrome CDP fallback, Git.

---

## File Structure

- Create: `images/lxue-ice-elf-wave-transparent.png` — transparent-background ice elf used only by the profile AI-platform heading.
- Modify: `profile.html` — replace the old robot asset reference and accessible alternative text.
- Verify only: `style.css` — retain the existing `158px` desktop and `96px` mobile `.ai-platform-robot` rules unless rendered evidence shows a regression.

### Task 1: Create and Verify the Transparent Ice-Elf Asset

**Files:**

- Source: `E:\图片\零雪IP\第三期\ChatGPT Image 2026年8月2日 19_19_50 (4).png`
- Create: `images/lxue-ice-elf-wave-transparent.png`

- [x] **Step 1: Generate the transparent PNG from the approved source**

The built-in image edit was attempted first but did not preserve a genuine transparent background and the original subject accurately. After the user explicitly approved a local fallback, `rembg` was used to derive the Alpha mask; the final asset preserves the source RGB exactly and keeps only the single connected character component.

Use the image-editing tool with the source file and this exact instruction:

```text
Remove the entire gray and black background from this exact image and return a PNG with a genuinely transparent alpha background. Preserve the ice elf character exactly: keep the full pale-blue hair, single curved ahoge, braid, snowflake hair ornament, both pointed ears, both outstretched hands and every finger, white sleeves, coat, belt, and visible lower clothing. Preserve the original square 1024×1024 canvas, character proportions, pose, face, colors, lighting, and edge detail. Do not crop, stretch, repaint, redesign, add shadows, add outlines, add scenery, add text, or add any new object. Make the removed background fully transparent, including all four corners, with clean anti-aliased edges and no dark halo.
```

Save the result exactly as `images/lxue-ice-elf-wave-transparent.png`.

- [x] **Step 2: Inspect the generated asset visually**

Open the result at original detail. Expected: the same character and pose are intact; the background displays as transparency; no hair, snowflake, ear, sleeve, hand, or finger is clipped.

- [x] **Step 3: Verify dimensions and Alpha transparency**

Run:

```powershell
Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Bitmap]::FromFile('images/lxue-ice-elf-wave-transparent.png')
try {
    if ($image.Width -ne 1024 -or $image.Height -ne 1024) { throw 'Unexpected dimensions' }
    $corners = @(
        $image.GetPixel(0, 0).A,
        $image.GetPixel(1023, 0).A,
        $image.GetPixel(0, 1023).A,
        $image.GetPixel(1023, 1023).A
    )
    if (($corners | Where-Object { $_ -ne 0 }).Count -ne 0) { throw 'Corners are not transparent' }
    [pscustomobject]@{ Width = $image.Width; Height = $image.Height; CornerAlpha = ($corners -join ',') }
} finally {
    $image.Dispose()
}
```

Expected: `Width=1024`, `Height=1024`, and `CornerAlpha=0,0,0,0`.

- [x] **Step 4: Commit the isolated asset**

```powershell
git add images/lxue-ice-elf-wave-transparent.png
git commit -m "assets: add transparent ice elf mascot"
```

### Task 2: Replace the Profile Heading Robot Without Changing Layout

**Files:**

- Modify: `profile.html:537`
- Verify only: `style.css:2479-2486`
- Verify only: `style.css:2510-2518`

- [x] **Step 1: Record the existing responsive sizing contract**

Run:

```powershell
Select-String -Path style.css -Pattern '\.ai-platform-robot' -Context 0,2
```

Expected: the desktop rule contains `width: 158px; height: 158px; object-fit: contain`, and the mobile rule contains `width: 96px; height: 96px`.

- [x] **Step 2: Replace only the image resource and alt text**

Change the existing element to this exact markup:

```html
<img class="ai-platform-robot" src="images/lxue-ice-elf-wave-transparent.png" width="1024" height="1024" loading="lazy" decoding="async" alt="零雪冰雪精灵介绍六大AI平台适配专题">
```

Do not edit the heading copy, topic cards, navigation, or responsive sizes.

- [x] **Step 3: Verify the reference and old image isolation**

Run:

```powershell
Select-String -Path profile.html -Pattern 'lxue-ice-elf-wave-transparent|yirui-robot-wave-cutout|零雪冰雪精灵'
git diff -- profile.html style.css
```

Expected: `profile.html` references the new image once; the old robot is absent from this page; `style.css` has no change unless visual testing proves one is required.

- [x] **Step 4: Commit the markup replacement**

```powershell
git add profile.html style.css
git commit -m "feat: replace profile robot with ice elf"
```

If `style.css` is unchanged, stage only `profile.html`.

### Task 3: Validate, Render, and Push `master`

**Files:**

- Verify: `profile.html`
- Verify: `style.css`
- Verify: `images/lxue-ice-elf-wave-transparent.png`
- Modify: `tools/validate-requested-fixes.mjs` — update the approved profile mascot regression contract.
- Modify: `tools/validate-ai-platform-admin.mjs` — update the focused profile mascot assertion.

- [x] **Step 1: Run static-site validation scripts**

Run:

```powershell
node tools/validate-site-content-consistency.mjs
node tools/validate-requested-fixes.mjs
node tools/validate-static-layout-restore.mjs
node tools/validate-unified-navbar.mjs
node tools/validate-ai-platform-admin.mjs
```

Expected: every command exits with code `0`.

- [x] **Step 2: Render the page at desktop width**

Serve the repository on `127.0.0.1:4173`, open `/profile.html#ai-platform-topics`, and capture a screenshot at `1920×1080`.

The Playwright CLI package lookup stalled in the local environment, so the same page was rendered in the installed Chrome browser through the Chrome DevTools Protocol. Computed layout metrics and a PNG screenshot were captured from the live page.

Expected:

- the ice elf replaces the robot in the right side of the heading;
- the background behind the character is the page's existing light grid, not a gray/black square;
- the character remains within `158×158px` and does not overlap the heading text or cards.

- [x] **Step 3: Render the page at mobile width**

Resize to `390×844`, reload `/profile.html#ai-platform-topics`, and capture a screenshot.

Expected: the character remains complete inside `96×96px`, the one-column heading flow remains intact, and no horizontal overflow appears.

- [x] **Step 4: Check exact Git scope and file integrity**

Run:

```powershell
git diff --check HEAD~2..HEAD
git status --short
git log -3 --oneline
```

Expected: no whitespace errors; existing untracked user files remain unmodified; commits contain only the specification/plan, new image, profile reference, responsive mascot sizing correction, and validator contract updates required by this task.

- [ ] **Step 5: Push the requested branch**

```powershell
git push origin master
```

Expected: `origin/master` advances to the verified local `master` commit without a force push.

- [ ] **Step 6: Confirm remote state**

```powershell
git status --short --branch
git log -1 --oneline origin/master
```

Expected: local `master` is aligned with `origin/master`; pre-existing untracked files may still be listed and must not be deleted.
