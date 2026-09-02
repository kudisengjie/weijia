import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(sourceDirectory, "..");
const modulePath = path.join(sourceDirectory, "model-switch.js");
const modelSwitch = fs.existsSync(modulePath)
  ? await import(pathToFileURL(modulePath).href)
  : {};

const expectedProviderIds = [
  "hunyuan",
  "qwen",
  "doubao",
  "deepseek",
  "minimax",
  "zhipu",
  "kimi",
  "mimo",
];

const expectedModels = {
  hunyuan: {
    primary: { model: "Hy3", modelId: "hy3" },
    secondary: { model: "Hy4 Preview", modelId: "hy4-preview" },
  },
  qwen: {
    primary: { model: "Qwen3.8 Flash", modelId: "qwen3.8-flash" },
    secondary: { model: "Qwen3.8 Max", modelId: "qwen3.8-max" },
  },
  doubao: {
    primary: { model: "Seed 2.0 Lite", modelId: "doubao-seed-2-0-lite-260215" },
    secondary: { model: "Seed 2.0 Pro", modelId: "doubao-seed-2-0-pro-260215" },
  },
  deepseek: {
    primary: { model: "V4 Flash", modelId: "deepseek-v4-flash" },
    secondary: { model: "V4 Pro", modelId: "deepseek-v4-pro" },
  },
  minimax: {
    primary: { model: "M2.7", modelId: "MiniMax-M2.7" },
    secondary: { model: "M3", modelId: "MiniMax-M3" },
  },
  zhipu: {
    primary: { model: "GLM-5.3 Flash", modelId: "glm-5.3-flash" },
    secondary: { model: "GLM-5.3", modelId: "glm-5.3" },
  },
  kimi: {
    primary: { model: "K2.7 Code", modelId: "kimi-k2.7-code" },
    secondary: { model: "K3", modelId: "kimi-k3" },
  },
  mimo: {
    primary: { model: "MiMo V2.5", modelId: "mimo-v2.5" },
    secondary: { model: "MiMo V2.5 Pro", modelId: "mimo-v2.5-pro" },
  },
};

test("DeepSeek Flash is the default static model", () => {
  assert.equal(modelSwitch.DEFAULT_MODEL_PROVIDER, "deepseek");
  assert.equal(modelSwitch.DEFAULT_MODEL_SLOT, "primary");
  assert.equal(modelSwitch.getModelPresentation?.().label, "DeepSeek V4 Flash");
});

test("catalog exposes exactly eight providers with their two reference models", () => {
  assert.deepEqual(modelSwitch.MODEL_PROVIDER_IDS, expectedProviderIds);

  for (const providerId of expectedProviderIds) {
    for (const slot of ["primary", "secondary"]) {
      const presentation = modelSwitch.getModelPresentation?.(providerId, slot);
      assert.equal(presentation?.id, providerId);
      assert.equal(presentation?.slot, slot);
      assert.equal(presentation?.model, expectedModels[providerId][slot].model);
      assert.equal(presentation?.modelId, expectedModels[providerId][slot].modelId);
      assert.match(presentation?.logo ?? "", /^assets\/model-logos\/[a-z-]+\.png$/);
    }
  }
});

test("unknown provider and slot fall back independently to DeepSeek V4 Flash", () => {
  assert.deepEqual(
    modelSwitch.getModelPresentation?.("unknown", "unknown"),
    modelSwitch.getModelPresentation?.("deepseek", "primary"),
  );
});

test("static settings group two model choices inside each of eight provider cards", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.equal(html.match(/class="geo-provider-card"/g)?.length, 8);
  assert.equal(html.match(/name="model-option"/g)?.length, 16);
  assert.doesNotMatch(html, /name="model-provider"|name="model-tier"/);
  assert.match(
    html,
    /name="model-option"[^>]*data-provider="deepseek"[^>]*data-slot="primary"[^>]*checked/,
  );
  for (const providerId of expectedProviderIds) {
    assert.equal(
      html.match(new RegExp(`data-provider="${providerId}"`, "g"))?.length,
      2,
      `${providerId} should expose two model choices`,
    );
  }
  for (const { primary, secondary } of Object.values(expectedModels)) {
    assert.ok(html.includes(`<strong>${primary.model}</strong>`));
    assert.ok(html.includes(`<strong>${secondary.model}</strong>`));
  }
  assert.doesNotMatch(html, /极速|深度|<small>Flash<\/small>|<small>Pro<\/small>/);
  assert.doesNotMatch(html, /Agnes/i);
});

test("all supplied logos are local assets", () => {
  for (const providerId of expectedProviderIds) {
    const logoPath = path.join(root, "assets", "model-logos", `${providerId}.png`);
    assert.equal(fs.existsSync(logoPath), true, `${providerId} logo should exist`);
  }
});

test("static preview keeps generation disabled and has no model transport", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
  assert.match(html, /<button(?=[^>]*id="run-task")(?=[^>]*disabled)[^>]*>/);
  assert.doesNotMatch(
    app,
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/,
  );
});

test("model choice dots and names stay on the same horizontal row", () => {
  const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.doesNotMatch(
    styles,
    /\.geo-settings-grid article span, \.geo-settings-grid article strong/,
    "generic settings-card styles must not override nested model controls",
  );
  assert.match(
    styles,
    /\.geo-settings-grid > article > span, \.geo-settings-grid > article > strong/,
  );
  assert.match(
    styles,
    /\.geo-model-option > span\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/s,
  );
  assert.match(
    styles,
    /\.geo-model-setting__intro > span, \.geo-model-setting__intro > strong\s*\{\s*display:\s*block;/,
    "the settings heading should keep its established stacked hierarchy",
  );
});

test("workspace omits the static preview notice module", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.doesNotMatch(html, /geo-notice|static-notice-title|这是静态文件预览模式/);
  assert.doesNotMatch(styles, /\.geo-notice/);
});
