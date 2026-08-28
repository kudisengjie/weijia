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

test("Agnes is the default static model", () => {
  assert.equal(modelSwitch.DEFAULT_MODEL_PROVIDER, "agnes");
  assert.deepEqual(modelSwitch.getModelPresentation?.(), {
    id: "agnes",
    provider: "Agnes",
    model: "2.5 Flash",
    label: "Agnes 2.5 Flash",
  });
});

test("DeepSeek can be selected and unknown values fall back to Agnes", () => {
  assert.equal(modelSwitch.getModelPresentation?.("deepseek").label, "DeepSeek V4 Flash");
  assert.equal(modelSwitch.getModelPresentation?.("unknown").id, "agnes");
});

test("static preview keeps generation disabled and has no model transport", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
  assert.match(html, /id="model-provider"/);
  assert.match(html, /<button[^>]*id="run-task"[^>]*disabled/);
  assert.doesNotMatch(
    app,
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/,
  );
});
