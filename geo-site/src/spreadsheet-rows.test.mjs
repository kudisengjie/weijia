import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.join(sourceDirectory, "spreadsheet-rows.js");
const spreadsheetRows = fs.existsSync(modulePath)
  ? await import(pathToFileURL(modulePath).href)
  : {};

test("spreadsheet rows ignore empty Excel formatting rows", () => {
  const rows = [
    ["品牌名", "GEO知识库", "问句"],
    ["美迪电商教育", "美迪知识库", "如何学习电商？"],
    ["  ", "", null],
    ...Array.from({ length: 197 }, () => ["", "", ""]),
  ];

  assert.equal(typeof spreadsheetRows.normalizeSpreadsheetRows, "function");
  assert.deepEqual(spreadsheetRows.normalizeSpreadsheetRows?.(rows), [
    ["品牌名", "GEO知识库", "问句"],
    ["美迪电商教育", "美迪知识库", "如何学习电商？"],
  ]);
});

test("spreadsheet normalization stringifies cells and preserves meaningful order", () => {
  assert.deepEqual(spreadsheetRows.normalizeSpreadsheetRows?.([
    ["标题", 12],
    [],
    [false, "内容"],
  ]), [
    ["标题", "12"],
    ["false", "内容"],
  ]);
});
