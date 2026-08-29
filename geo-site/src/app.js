import * as XLSX from "xlsx";
import * as mammoth from "mammoth";
import { strFromU8, unzipSync } from "fflate";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  DEFAULT_MODEL_PROVIDER,
  DEFAULT_MODEL_SLOT,
  getModelPresentation,
} from "./model-switch.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("assets/pdf.worker.min.mjs", document.baseURI).href;

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PREVIEW_CHARS = 12000;
const MAX_TABLE_ROWS = 20;
const MAX_TABLE_COLUMNS = 12;

const taskInput = document.getElementById("task-file");
const companyInput = document.getElementById("company-files");
const taskDisplay = document.getElementById("task-file-display");
const companyList = document.getElementById("company-file-list");
const taskPreview = document.getElementById("task-preview");
const companyPreview = document.getElementById("company-preview");
const clearButton = document.getElementById("clear-files");
const taskState = document.getElementById("task-state");
const companyState = document.getElementById("company-state");
const checkTask = document.getElementById("check-task");
const checkCompany = document.getElementById("check-company");
const statusTask = document.getElementById("status-task");
const statusDocs = document.getElementById("status-docs");
const statusRead = document.getElementById("status-read");
const modelOptionInputs = document.querySelectorAll('input[name="model-option"]');

let currentTask = null;
let currentCompanies = [];
function renderSelectedModel(
  provider = DEFAULT_MODEL_PROVIDER,
  slot = DEFAULT_MODEL_SLOT,
) {
  const selected = getModelPresentation(provider, slot);
  modelOptionInputs.forEach((input) => {
    input.checked = input.dataset.provider === selected.id
      && input.dataset.slot === selected.slot;
  });
  document.querySelectorAll("[data-selected-model-provider]").forEach((node) => {
    node.textContent = selected.provider;
  });
  document.querySelectorAll("[data-selected-model-name]").forEach((node) => {
    node.textContent = selected.model;
  });
  document.querySelectorAll("[data-selected-model-label]").forEach((node) => {
    node.textContent = selected.label;
  });
  document.querySelectorAll("[data-selected-model-preflight]").forEach((node) => {
    node.textContent = `${selected.label} · 静态页未连接`;
  });
  document.querySelectorAll("[data-selected-model-connection]").forEach((node) => {
    node.textContent = `${selected.label} · 未连接`;
  });
  document.querySelectorAll("[data-selected-model-id]").forEach((node) => {
    node.textContent = selected.modelId;
  });
  document.querySelectorAll("[data-selected-model-service]").forEach((node) => {
    node.textContent = `${selected.provider} · 未连接`;
  });
}

function extensionOf(fileName) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index + 1).toLowerCase() : "";
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ensureReadable(file) {
  if (!file || file.size === 0) throw new Error("文件为空，无法读取内容。");
  if (file.size > MAX_FILE_BYTES) throw new Error("文件超过 25 MB，请压缩或拆分后再预览。");
}

function truncate(text) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= MAX_PREVIEW_CHARS) return { text: normalized, truncated: false, total: normalized.length };
  return { text: `${normalized.slice(0, MAX_PREVIEW_CHARS)}\n\n……预览已截断`, truncated: true, total: normalized.length };
}

function makeFileItem(file, status, detail = "") {
  const item = document.createElement("li");
  item.className = `geo-file-item is-${status}`;
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = file.name;
  const meta = document.createElement("small");
  meta.textContent = `${formatSize(file.size)}${detail ? ` · ${detail}` : ""}`;
  const state = document.createElement("em");
  state.textContent = status === "ready" ? "已读取" : status === "error" ? "未读取" : "读取中";
  copy.append(name, meta);
  item.append(copy, state);
  return item;
}

function makeMeta(label, value) {
  const item = document.createElement("span");
  const key = document.createElement("small");
  key.textContent = label;
  const content = document.createElement("strong");
  content.textContent = String(value);
  item.append(key, content);
  return item;
}

function readSpreadsheetRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false }).map((row) =>
    Array.from(row, (cell) => String(cell ?? "")),
  );
}

async function readSpreadsheet(file) {
  ensureReadable(file);
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true, cellText: true });
  if (!workbook.SheetNames.length) throw new Error("任务表中没有可读取的工作表。");
  const sheets = workbook.SheetNames.map((name) => ({ name, rows: readSpreadsheetRows(workbook.Sheets[name]) }));
  return { sheets };
}

async function readDocx(file) {
  ensureReadable(file);
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const preview = truncate(result.value);
  if (!preview.text) throw new Error("DOCX 中没有提取到可显示的文字。");
  return { ...preview, notes: result.messages.length };
}

async function readPdf(file) {
  ensureReadable(file);
  const documentTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await documentTask.promise;
  const pageCount = Math.min(pdf.numPages, 50);
  const parts = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    parts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  const preview = truncate(parts.join("\n\n"));
  if (!preview.text) throw new Error("PDF 中没有提取到可显示的文字；文件可能是扫描图片。");
  return { ...preview, pages: pdf.numPages, limitedPages: pdf.numPages > pageCount };
}

function cleanRtf(raw) {
  return raw
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\([{}\\])/g, "$1");
}

async function readOdt(file) {
  ensureReadable(file);
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const content = entries["content.xml"];
  if (!content) throw new Error("ODT 中缺少 content.xml，无法读取正文。");
  const xml = new DOMParser().parseFromString(strFromU8(content), "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("ODT 正文 XML 无法解析。");
  const paragraphs = Array.from(xml.getElementsByTagName("text:p"), (node) => node.textContent || "");
  const headings = Array.from(xml.getElementsByTagName("text:h"), (node) => node.textContent || "");
  const preview = truncate([...headings, ...paragraphs].join("\n"));
  if (!preview.text) throw new Error("ODT 中没有提取到可显示的文字。");
  return preview;
}

async function readTextDocument(file, extension) {
  ensureReadable(file);
  const raw = await file.text();
  const preview = truncate(extension === "rtf" ? cleanRtf(raw) : raw);
  if (!preview.text) throw new Error("文档中没有可显示的文字。");
  return preview;
}

async function readCompanyDocument(file) {
  const extension = extensionOf(file.name);
  if (extension === "docx") return readDocx(file);
  if (extension === "pdf") return readPdf(file);
  if (extension === "odt") return readOdt(file);
  if (["txt", "md", "rtf"].includes(extension)) return readTextDocument(file, extension);
  if (extension === "doc") throw new Error("旧版 DOC 无法在静态浏览器中可靠提取，请在 Word 中另存为 DOCX 后重新选择。");
  throw new Error(`暂不支持读取 .${extension || "未知"} 文件。`);
}

function renderSheet(data, sheetIndex) {
  taskPreview.replaceChildren();
  taskPreview.hidden = false;
  const sheet = data.sheets[sheetIndex];
  const heading = document.createElement("div");
  heading.className = "geo-preview__heading";
  const title = document.createElement("h3");
  title.textContent = "任务表内容预览";
  const selector = document.createElement("select");
  selector.setAttribute("aria-label", "选择工作表");
  data.sheets.forEach((item, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = item.name;
    option.selected = index === sheetIndex;
    selector.appendChild(option);
  });
  selector.addEventListener("change", () => renderSheet(data, Number(selector.value)));
  heading.append(title, selector);

  const maxColumns = sheet.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const meta = document.createElement("div");
  meta.className = "geo-preview__meta";
  meta.append(makeMeta("工作表", sheet.name), makeMeta("总行数", sheet.rows.length), makeMeta("最多列数", maxColumns));

  const tableWrap = document.createElement("div");
  tableWrap.className = "geo-table-wrap";
  const table = document.createElement("table");
  const rows = sheet.rows.slice(0, MAX_TABLE_ROWS);
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    row.slice(0, MAX_TABLE_COLUMNS).forEach((cell) => {
      const node = document.createElement(rowIndex === 0 ? "th" : "td");
      node.textContent = cell;
      tr.appendChild(node);
    });
    table.appendChild(tr);
  });
  tableWrap.appendChild(table);
  taskPreview.append(heading, meta, tableWrap);
}

function renderCompanyPreviews() {
  companyPreview.replaceChildren();
  companyPreview.hidden = currentCompanies.length === 0;
  currentCompanies.forEach((item, index) => {
    const details = document.createElement("details");
    details.open = index === 0;
    details.className = item.error ? "is-error" : "is-ready";
    const summary = document.createElement("summary");
    const name = document.createElement("strong");
    name.textContent = item.file.name;
    const status = document.createElement("span");
    status.textContent = item.error ? "读取失败" : `${item.result.total.toLocaleString("zh-CN")} 字符`;
    summary.append(name, status);
    const content = document.createElement("pre");
    content.textContent = item.error ? item.error : item.result.text;
    details.append(summary, content);
    companyPreview.appendChild(details);
  });
}

function updateStatus() {
  const total = (currentTask ? 1 : 0) + currentCompanies.length;
  const success = (currentTask?.data ? 1 : 0) + currentCompanies.filter((item) => item.result).length;
  statusRead.textContent = `${success} / ${total}`;
  statusTask.textContent = currentTask ? (currentTask.data ? "已读取" : currentTask.error ? "读取失败" : "读取中") : "暂无";
  statusDocs.textContent = String(currentCompanies.length);
  clearButton.disabled = total === 0;
}

async function handleTaskFile() {
  const file = taskInput.files?.[0];
  taskDisplay.replaceChildren();
  taskPreview.replaceChildren();
  taskPreview.hidden = true;
  if (!file) {
    currentTask = null;
    const empty = document.createElement("span");
    empty.className = "geo-file-slot__empty";
    empty.textContent = "尚未选择任务表";
    taskDisplay.appendChild(empty);
    taskState.textContent = "未选择";
    checkTask.textContent = "等待选择";
    updateStatus();
    return;
  }

  currentTask = { file, data: null, error: "" };
  taskDisplay.appendChild(makeFileItem(file, "loading"));
  taskState.textContent = "读取中";
  checkTask.textContent = "正在读取";
  updateStatus();
  try {
    currentTask.data = await readSpreadsheet(file);
    taskDisplay.replaceChildren(makeFileItem(file, "ready", `${currentTask.data.sheets.length} 个工作表`));
    taskState.textContent = "已读取";
    checkTask.textContent = `已读取 ${currentTask.data.sheets.length} 个工作表`;
    renderSheet(currentTask.data, 0);
  } catch (error) {
    currentTask.error = error instanceof Error ? error.message : "文件读取失败。";
    taskDisplay.replaceChildren(makeFileItem(file, "error", currentTask.error));
    taskState.textContent = "读取失败";
    checkTask.textContent = currentTask.error;
  }
  updateStatus();
}

async function handleCompanyFiles() {
  const files = Array.from(companyInput.files || []);
  currentCompanies = files.map((file) => ({ file, result: null, error: "" }));
  companyList.replaceChildren();
  companyPreview.replaceChildren();
  companyPreview.hidden = true;
  companyState.textContent = files.length ? "读取中" : "0 个文档";
  checkCompany.textContent = files.length ? "正在读取" : "等待选择";
  if (!files.length) {
    const empty = document.createElement("li");
    empty.className = "geo-file-list__empty";
    empty.textContent = "尚未选择公司介绍文档";
    companyList.appendChild(empty);
    updateStatus();
    return;
  }

  files.forEach((file) => companyList.appendChild(makeFileItem(file, "loading")));
  updateStatus();
  for (let index = 0; index < currentCompanies.length; index += 1) {
    const item = currentCompanies[index];
    try {
      item.result = await readCompanyDocument(item.file);
    } catch (error) {
      item.error = error instanceof Error ? error.message : "文件读取失败。";
    }
    companyList.children[index].replaceWith(makeFileItem(item.file, item.error ? "error" : "ready", item.error || `${item.result.total.toLocaleString("zh-CN")} 字符`));
    renderCompanyPreviews();
    updateStatus();
  }
  const successful = currentCompanies.filter((item) => item.result).length;
  companyState.textContent = `${successful}/${files.length} 已读取`;
  checkCompany.textContent = successful === files.length ? `已读取 ${successful} 个文档` : `已读取 ${successful}/${files.length}，请查看提示`;
}

function clearFiles() {
  taskInput.value = "";
  companyInput.value = "";
  currentTask = null;
  currentCompanies = [];
  handleTaskFile();
  handleCompanyFiles();
}

function changeView(name) {
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle("is-selected", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    const active = panel.dataset.viewPanel === name;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

taskInput.addEventListener("change", handleTaskFile);
companyInput.addEventListener("change", handleCompanyFiles);
clearButton.addEventListener("click", clearFiles);
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => changeView(button.dataset.view)));
modelOptionInputs.forEach((input) => input.addEventListener("change", () => {
  if (input.checked) renderSelectedModel(input.dataset.provider, input.dataset.slot);
}));
renderSelectedModel();
updateStatus();
