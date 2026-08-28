# 官网静态 GEO 模型切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在官网纯静态 GEO 预览页加入 Agnes/DeepSeek 展示切换，同时保证生成按钮永久禁用且不存在任何模型 API 请求。

**Architecture:** 用独立纯函数模块保存两个固定模型的展示元数据，`src/app.js` 只维护当前页面内存状态并同步已有 DOM。官网不复用本地运行时、不保存选择、不读取密钥，也不增加网络层。

**Tech Stack:** HTML、CSS、原生 JavaScript、Node.js 内置测试运行器、esbuild

---

### Task 1: 固定模型目录与静态安全契约

**Files:**
- Create: `geo-site/src/model-switch.js`
- Create: `geo-site/src/model-switch.test.mjs`
- Modify: `geo-site/package.json`

- [ ] **Step 1: 写失败测试**

创建 `geo-site/src/model-switch.test.mjs`，覆盖默认 Agnes、DeepSeek 切换、非法值回退，以及官网没有模型网络请求的静态契约：

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEFAULT_MODEL_PROVIDER, getModelPresentation } from "./model-switch.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Agnes is the default static model", () => {
  assert.equal(DEFAULT_MODEL_PROVIDER, "agnes");
  assert.deepEqual(getModelPresentation(), {
    id: "agnes",
    provider: "Agnes",
    model: "2.5 Flash",
    label: "Agnes 2.5 Flash",
  });
});

test("DeepSeek can be selected and unknown values fall back to Agnes", () => {
  assert.equal(getModelPresentation("deepseek").label, "DeepSeek V4 Flash");
  assert.equal(getModelPresentation("unknown").id, "agnes");
});

test("static preview keeps generation disabled and has no model transport", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
  assert.match(html, /id="model-provider"/);
  assert.match(html, /id="run-task"[^>]*disabled/);
  assert.doesNotMatch(app, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/);
});
```

在 `package.json` 中增加：

```json
"test": "node --test src/model-switch.test.mjs"
```

- [ ] **Step 2: 运行测试并确认失败原因正确**

Run: `npm test`

Expected: FAIL，因为 `src/model-switch.js` 和 `#model-provider` 尚不存在。

- [ ] **Step 3: 实现最小模型目录**

创建 `geo-site/src/model-switch.js`：

```js
export const DEFAULT_MODEL_PROVIDER = "agnes";

const MODEL_PRESENTATIONS = Object.freeze({
  agnes: Object.freeze({ id: "agnes", provider: "Agnes", model: "2.5 Flash", label: "Agnes 2.5 Flash" }),
  deepseek: Object.freeze({ id: "deepseek", provider: "DeepSeek", model: "V4 Flash", label: "DeepSeek V4 Flash" }),
});

export function getModelPresentation(provider = DEFAULT_MODEL_PROVIDER) {
  return MODEL_PRESENTATIONS[provider] ?? MODEL_PRESENTATIONS[DEFAULT_MODEL_PROVIDER];
}
```

- [ ] **Step 4: 暂不运行第二次测试**

测试还会因 HTML 尚未接入而失败；继续 Task 2 后统一运行一次通过验证，避免重复操作。

### Task 2: 将选择状态接入静态页面

**Files:**
- Modify: `geo-site/index.html`
- Modify: `geo-site/src/app.js`
- Modify: `geo-site/styles.css`

- [ ] **Step 1: 添加语义化模型选择界面**

在设置页加入固定原生下拉框：

```html
<article class="geo-model-setting">
  <label for="model-provider">批次模型</label>
  <select id="model-provider">
    <option value="agnes" selected>Agnes 2.5 Flash</option>
    <option value="deepseek">DeepSeek V4 Flash</option>
  </select>
  <strong><span data-selected-model-label>Agnes 2.5 Flash</span> · 未连接</strong>
  <p>仅切换静态展示；刷新后恢复 Agnes，不会调用模型。</p>
</article>
```

把工作区模型卡、静态前置检查和状态舱中的模型文字换成 `data-selected-model-provider`、`data-selected-model-name` 或 `data-selected-model-label` 标记。更新说明文字，明确不会连接 IMA、Agnes 或 DeepSeek；保持 `#run-task` 的 `disabled` 属性。

- [ ] **Step 2: 绑定仅内存状态**

在 `src/app.js` 中导入模型目录并同步所有展示节点：

```js
import { DEFAULT_MODEL_PROVIDER, getModelPresentation } from "./model-switch.js";

const modelProviderSelect = document.getElementById("model-provider");

function renderSelectedModel(provider = DEFAULT_MODEL_PROVIDER) {
  const selected = getModelPresentation(provider);
  modelProviderSelect.value = selected.id;
  document.querySelectorAll("[data-selected-model-provider]").forEach((node) => { node.textContent = selected.provider; });
  document.querySelectorAll("[data-selected-model-name]").forEach((node) => { node.textContent = selected.model; });
  document.querySelectorAll("[data-selected-model-label]").forEach((node) => { node.textContent = selected.label; });
}

modelProviderSelect.addEventListener("change", () => renderSelectedModel(modelProviderSelect.value));
renderSelectedModel();
```

不使用 `localStorage`、Cookie 或任何请求 API。

- [ ] **Step 3: 完成响应式与焦点样式**

在 `styles.css` 中增加与现有冰蓝卡片一致的选择控件样式：

```css
.geo-model-setting label { display: block; color: #7a90aa; font-size: 9px; font-weight: 800; letter-spacing: .08em; }
.geo-model-setting select { width: 100%; margin-top: 10px; padding: 10px 12px; border: 1px solid #c9dff7; border-radius: 10px; color: var(--ink); background: #fff; font: inherit; }
.geo-model-setting select:focus-visible { outline: 3px solid rgba(91, 153, 226, .28); outline-offset: 2px; }
```

沿用现有 `760px` 下单列设置卡布局，不新增横向溢出。

### Task 3: 一次性验证、构建与提交

**Files:**
- Verify: `geo-site/index.html`
- Verify: `geo-site/src/app.js`
- Verify: `geo-site/assets/app.js`

- [ ] **Step 1: 运行唯一自动化验证**

Run: `npm test && npm run build`

Expected: Node 测试全部 PASS；esbuild 输出 `Built geo-site/assets/app.js and local PDF worker.`

- [ ] **Step 2: 做一次浏览器冒烟检查**

打开 `geo-site/index.html`，确认默认 Agnes；切换 DeepSeek 后工作区、前置检查和设置页同步；刷新恢复 Agnes；生成按钮保持禁用；移动端宽度下没有横向溢出。浏览器网络面板不得出现 Agnes、DeepSeek 或 IMA 请求。

- [ ] **Step 3: 只提交任务涉及的文件**

```powershell
git add -- geo-site/index.html geo-site/styles.css geo-site/package.json geo-site/src/app.js geo-site/src/model-switch.js geo-site/src/model-switch.test.mjs geo-site/assets/app.js
git commit -m "feat: add static GEO model switch"
```

- [ ] **Step 4: 推送官网仓库**

Run: `git push origin master`

Expected: `master -> master`，不包含工作区中其他未跟踪文件。

