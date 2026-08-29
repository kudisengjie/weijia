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

const expectedModelIds = {
  hunyuan: { flash: "hy3 · no_think", pro: "hy3 · think_high" },
  qwen: { flash: "qwen3.8-flash", pro: "qwen3.8-max" },
  doubao: { flash: "Doubao-Seed-2.1-Turbo", pro: "Doubao-Seed-2.1-Pro" },
  deepseek: { flash: "deepseek-v4-flash", pro: "deepseek-v4-pro" },
  minimax: { flash: "MiniMax-M3 · thinking disabled", pro: "MiniMax-M3 · thinking enabled" },
  zhipu: { flash: "glm-5.2 · reasoning low", pro: "glm-5.2 · reasoning max" },
  kimi: { flash: "kimi-k3 · reasoning low", pro: "kimi-k3 · reasoning max" },
  mimo: { flash: "mimo-v2-flash", pro: "mimo-v2.5-pro" },
};

test("DeepSeek Flash is the default static model", () => {
  assert.equal(modelSwitch.DEFAULT_MODEL_PROVIDER, "deepseek");
  assert.equal(modelSwitch.DEFAULT_MODEL_TIER, "flash");
  assert.equal(modelSwitch.getModelPresentation?.().label, "DeepSeek V4 Flash");
});

test("catalog exposes exactly eight providers with Flash and Pro presentations", () => {
  assert.deepEqual(modelSwitch.MODEL_PROVIDER_IDS, expectedProviderIds);

  for (const providerId of expectedProviderIds) {
    for (const tier of ["flash", "pro"]) {
      const presentation = modelSwitch.getModelPresentation?.(providerId, tier);
      assert.equal(presentation?.id, providerId);
      assert.equal(presentation?.tier, tier);
      assert.equal(presentation?.modelId, expectedModelIds[providerId][tier]);
      assert.match(presentation?.logo ?? "", /^assets\/model-logos\/[a-z-]+\.png$/);
    }
  }
});

test("unknown provider and tier fall back independently to DeepSeek Flash", () => {
  assert.deepEqual(
    modelSwitch.getModelPresentation?.("unknown", "unknown"),
    modelSwitch.getModelPresentation?.("deepseek", "flash"),
  );
});

test("static settings group two model choices inside each of eight provider cards", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.equal(html.match(/class="geo-provider-card"/g)?.length, 8);
  assert.equal(html.match(/name="model-option"/g)?.length, 16);
  assert.doesNotMatch(html, /name="model-provider"|name="model-tier"/);
  assert.match(
    html,
    /name="model-option"[^>]*data-provider="deepseek"[^>]*data-tier="flash"[^>]*checked/,
  );
  for (const providerId of expectedProviderIds) {
    assert.equal(
      html.match(new RegExp(`data-provider="${providerId}"`, "g"))?.length,
      2,
      `${providerId} should expose two model choices`,
    );
  }
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
