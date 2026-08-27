import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

const geoFiles = [
  "geo-site/index.html",
  "geo-site/styles.css",
  "geo-site/src/app.js",
  "geo-site/assets/app.js",
  "geo-site/assets/lxue-geo-founder.png",
  "geo-site/edgeone.json",
];

for (const file of geoFiles) {
  expect(fs.existsSync(path.join(root, file)), `missing ${file}`);
}

if (failures.length === 0) {
  const html = read("geo-site/index.html");
  const css = read("geo-site/styles.css");
  const source = read("geo-site/src/app.js");
  const bundle = read("geo-site/assets/app.js");
  const siteScript = read("script.js");
  const edgeOne = JSON.parse(read("geo-site/edgeone.json"));

  expect(html.includes('id="task-file"'), "missing Excel task input");
  expect(html.includes('accept=".xlsx,.xls,.csv"'), "task input must restrict spreadsheet suffixes");
  expect(html.includes('id="company-files"'), "missing company document input");
  expect(html.includes("multiple"), "company input must support multiple brands");
  expect(html.includes('id="task-preview"'), "missing spreadsheet content preview");
  expect(html.includes('id="company-preview"'), "missing company document content preview");
  expect(html.includes('data-view="workspace"'), "missing batch workspace view");
  expect(html.includes('data-view="history"'), "missing history view");
  expect(html.includes('data-view="completed"'), "missing completed articles view");
  expect(html.includes('data-view="settings"'), "missing settings view");
  expect(html.includes('id="run-task"') && html.includes("disabled"), "run button must remain disabled");
  expect(html.includes("静态文件预览模式") && html.includes("不会运行生成任务"), "missing static-mode disclosure");
  expect(html.includes('assets/lxue-geo-founder.png'), "missing Lxue IP image");
  expect(css.includes("@media (max-width: 760px)"), "missing mobile layout");
  expect(css.includes("prefers-reduced-motion"), "missing reduced-motion support");
  expect(
    /@media\s*\(max-width:\s*520px\)\s*\{[\s\S]*?\.geo-steps\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*gap:\s*8px/s.test(css),
    "phone workflow steps must use a readable two-column grid"
  );
  expect(
    /@media\s*\(max-width:\s*520px\)\s*\{[\s\S]*?\.geo-steps li\s*\{[^}]*min-height:\s*64px[^}]*padding:\s*10px/s.test(css),
    "phone workflow step cards must retain readable height and padding"
  );
  expect(
    /@media\s*\(max-width:\s*520px\)\s*\{[\s\S]*?\.geo-step__number\s*\{[^}]*flex:\s*0 0 34px[^}]*height:\s*34px/s.test(css),
    "phone workflow step numbers must not shrink"
  );
  expect(source.includes("readSpreadsheet"), "spreadsheet content reader is missing");
  expect(source.includes("readDocx"), "DOCX content reader is missing");
  expect(source.includes("readPdf"), "PDF content reader is missing");
  expect(source.includes("file.text()"), "plain-text content reader is missing");
  expect(source.includes('addEventListener("change"'), "file inputs must update local UI");
  expect(!/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/.test(source), "static source must not make network requests");
  expect(!/api\.deepseek|ima\.qq|openapi/i.test(source), "static source must not contain model or IMA endpoints");
  expect(siteScript.includes("entry.href = 'https://geo.lxue.xin/';"), "footer must point to https://geo.lxue.xin/");
  expect(edgeOne.headers?.some((rule) => rule.source === "/*"), "dedicated GEO EdgeOne config needs static security headers");
}

if (failures.length) {
  console.error("Static GEO workbench validation failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Static GEO workbench validation passed.");
