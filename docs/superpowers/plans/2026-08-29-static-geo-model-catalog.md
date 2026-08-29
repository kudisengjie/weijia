# 官网静态 GEO 八厂商模型目录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把官网静态 GEO 页升级为八厂商、Flash / Pro 双档模型目录，默认 DeepSeek Flash，并保持完全无 API、不可运行。

**Architecture:** `src/model-switch.js` 提供不可变模型目录和纯函数选择接口；`index.html` 使用原生 radio 构成 Logo 卡片与模式分段开关；`src/app.js` 只同步当前选择到既有状态节点。所有厂商素材复制到本地 `assets/model-logos/`，不增加网络依赖。

**Tech Stack:** HTML、CSS、原生 JavaScript、Node.js 内置测试运行器、esbuild

---

### Task 1: 用失败测试锁定八厂商目录契约

**Files:**
- Modify: `geo-site/src/model-switch.test.mjs`
- Test: `geo-site/src/model-switch.test.mjs`

- [ ] **Step 1: 将旧 Agnes 测试改为新目录测试**

测试必须断言：

```js
assert.equal(DEFAULT_MODEL_PROVIDER, "deepseek");
assert.equal(DEFAULT_MODEL_TIER, "flash");
assert.deepEqual(MODEL_PROVIDER_IDS, [
  "hunyuan", "qwen", "doubao", "deepseek",
  "minimax", "zhipu", "kimi", "mimo",
]);
assert.equal(getModelPresentation("deepseek", "pro").modelId, "deepseek-v4-pro");
assert.equal(getModelPresentation("qwen", "pro").modelId, "qwen3.8-max");
assert.equal(getModelPresentation("unknown", "unknown").id, "deepseek");
```

静态契约继续断言 `#run-task` 禁用、源码没有网络传输 API，并新增八个 `name="model-provider"`、两个 `name="model-tier"`、无 Agnes 文案和八个本地 Logo 文件的断言。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test`

Expected: FAIL，因为 `DEFAULT_MODEL_TIER`、`MODEL_PROVIDER_IDS` 和八厂商目录尚未实现，HTML 仍是 Agnes / DeepSeek 下拉框。

### Task 2: 实现纯模型目录

**Files:**
- Modify: `geo-site/src/model-switch.js`
- Test: `geo-site/src/model-switch.test.mjs`

- [ ] **Step 1: 建立两维模型目录**

导出：

```js
export const DEFAULT_MODEL_PROVIDER = "deepseek";
export const DEFAULT_MODEL_TIER = "flash";
export const MODEL_PROVIDER_IDS = Object.freeze([
  "hunyuan", "qwen", "doubao", "deepseek",
  "minimax", "zhipu", "kimi", "mimo",
]);
export function getModelPresentation(provider, tier) { /* 返回规范化扁平对象 */ }
```

每个返回对象固定包含 `id`、`provider`、`tier`、`tierLabel`、`model`、`modelId`、`label` 和 `logo`。非法厂商或档位分别回退为 DeepSeek 和 Flash。

- [ ] **Step 2: 暂不重复运行测试**

HTML 契约仍会失败；完成 Task 3 后统一运行 GREEN。

### Task 3: 接入 Logo 卡片、模式开关和同步状态

**Files:**
- Modify: `geo-site/index.html`
- Modify: `geo-site/src/app.js`
- Modify: `geo-site/styles.css`
- Create: `geo-site/assets/model-logos/hunyuan.png`
- Create: `geo-site/assets/model-logos/qwen.png`
- Create: `geo-site/assets/model-logos/doubao.png`
- Create: `geo-site/assets/model-logos/deepseek.png`
- Create: `geo-site/assets/model-logos/minimax.png`
- Create: `geo-site/assets/model-logos/zhipu.png`
- Create: `geo-site/assets/model-logos/kimi.png`
- Create: `geo-site/assets/model-logos/mimo.png`

- [ ] **Step 1: 复制用户提供的八个 Logo**

从用户提供的 `E:\美迪电商\媒体和AI平台LOGO\` 素材复制到 `geo-site/assets/model-logos/`，统一使用 ASCII 文件名；不修改源文件。

- [ ] **Step 2: 用原生 radio 替换下拉框**

设置页加入 `name="model-provider"` 的八张 Logo 卡和 `name="model-tier"` 的 Flash / Pro 两段式控件。DeepSeek 与 Flash 带 `checked`。增加 `data-selected-model-id` 节点展示真实映射。

- [ ] **Step 3: 同步二维选择**

`src/app.js` 导入 `DEFAULT_MODEL_TIER`，为厂商与档位 radio 注册 `change`；`renderSelectedModel(provider, tier)` 同步 checked 状态以及既有 `data-selected-model-*` 节点。不得加入持久化或请求。

- [ ] **Step 4: 完成桌面与移动样式**

桌面四列、760px 以下两列；radio 保持屏幕阅读器可读，卡片具备 `:checked`、`:hover` 和 `:focus-visible` 状态。Logo 使用固定容器和 `object-fit: contain`，不得拉伸。

### Task 4: GREEN、构建和一次浏览器验证

**Files:**
- Verify: `geo-site/src/model-switch.test.mjs`
- Verify: `geo-site/index.html`
- Verify: `geo-site/styles.css`
- Verify: `geo-site/src/app.js`
- Build: `geo-site/assets/app.js`

- [ ] **Step 1: 运行自动化测试和构建**

Run: `npm test`

Expected: 目录、HTML、安全契约与 Logo 测试全部 PASS。

Run: `npm run build`

Expected: 输出 `Built geo-site/assets/app.js and local PDF worker.`

- [ ] **Step 2: 浏览器只做一轮桌面与移动冒烟检查**

在桌面宽度确认八卡四列、默认 DeepSeek Flash、切换厂商和 Pro 后所有状态同步；在 390px 宽度确认两列、无横向溢出、焦点可见。`#run-task` 必须保持禁用。

### Task 5: 精确提交并推送远程 master

**Files:**
- Commit: only files listed in Tasks 1-4 plus this spec and plan

- [ ] **Step 1: 检查差异和提交范围**

Run: `git diff --check`

Expected: no output.

Run: `git status --short`

Expected: only task files are modified or added.

- [ ] **Step 2: 提交**

```powershell
git add -- docs/superpowers/specs/2026-08-29-static-geo-model-catalog-design.md docs/superpowers/plans/2026-08-29-static-geo-model-catalog.md geo-site/index.html geo-site/styles.css geo-site/src/app.js geo-site/src/model-switch.js geo-site/src/model-switch.test.mjs geo-site/assets/app.js geo-site/assets/model-logos
git commit -m "feat: expand static GEO model catalog"
```

- [ ] **Step 3: 推送当前提交到远程 master**

Run: `git push origin HEAD:master`

Expected: remote `master` advances to this commit without包含任何主工作区未跟踪文件。

