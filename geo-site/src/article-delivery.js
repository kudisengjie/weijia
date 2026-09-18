// 本地交付闭环（阶段 D）：待交付清单 → 下载正文 → 写盘 → 幂等回执 → outbox 补确认。
// 设计依据 docs/superpowers/plans/2026-09-16-glm-development-handoff.md §8/§12 阶段 D-2。
// 原则：写盘成功并读回校验通过后才允许发回执；回执发出前先入 outbox，
// 网络丢响应由 outbox 以同一 requestId 补确认，服务器端按 artifactId/requestId 幂等。
// 依赖注入：api（JSON 接口）、download（原始字节下载）、localOutput（写盘）、
// outbox（IndexedDB 适配）可替换，Node 中以真实磁盘适配器验证。
import { safeFileName } from './local-output.js';
import { sha256Hex } from './hash-bytes.js';

export const DELIVERY_ERRORS = Object.freeze({
  VERIFY_FAILED: 'VERIFY_FAILED',
  NO_SCOPE: 'NO_ACCOUNT_SCOPE',
});

const OUTBOX_PREFIX = 'receipt:';

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(value));
}

// 默认本机存储：IndexedDB 独立库，键 receipt:<artifactId>。
function defaultOutbox() {
  if (typeof indexedDB === 'undefined') {
    return {
      async keys() { return []; },
      async get() { return null; },
      async set() { throw fail(DELIVERY_ERRORS.NO_SCOPE, '当前环境没有可用的本机存储，无法记录补确认任务。'); },
      async delete() {},
    };
  }
  const DB_NAME = 'lxue-geo-delivery-outbox', STORE = 'receipts';
  const withStore = async mode => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(STORE, mode);
      resolve({store: tx.objectStore(STORE), done: new Promise((res, rej) => {
        tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
      })});
    };
  });
  return {
    async keys() {
      const {store, done} = await withStore('readonly');
      const keys = await new Promise((resolve, reject) => {
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result ?? []);
        request.onerror = () => reject(request.error);
      });
      await done;
      return keys;
    },
    async get(key) {
      const {store, done} = await withStore('readonly');
      const value = await new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
      await done;
      return value;
    },
    async set(key, value) {
      const {store, done} = await withStore('readwrite');
      store.put(value, key);
      await done;
    },
    async delete(key) {
      const {store, done} = await withStore('readwrite');
      store.delete(key);
      await done;
    },
  };
}

export function createArticleDelivery({api, download, localOutput, outbox, accountScope = null,
  onPendingChange = () => {}, onBatch = () => {}, makeId = () => crypto.randomUUID()} = {}) {
  if (!outbox) outbox = defaultOutbox();
  let scope = accountScope;
  let pendingCount = null;
  let busy = false; // 交付进行中，阻止重入导致同一 artifact 并发写盘/回执。

  function requireScope() {
    if (!scope) throw fail(DELIVERY_ERRORS.NO_SCOPE, '尚未确认登录账号，无法补存文章。');
    return scope;
  }

  function notify() { onPendingChange(pendingCount); }

  // 单篇交付：下载 → 哈希校验 → 写盘 → 入 outbox → 回执 → 清 outbox。
  // 任何一步失败都保持服务器 pending 状态，由清单与 outbox 兜底。
  async function deliverOne(entry) {
    requireScope();
    const artifactId = String(entry.artifactId);
    const existing = await outbox.get(OUTBOX_PREFIX + artifactId);
    const requestId = existing?.requestId || makeId();
    if (!isUuid(requestId)) throw fail(DELIVERY_ERRORS.VERIFY_FAILED, '补确认标识无效，请重新登录后重试。');

    const contents = await download(artifactId);
    const downloadedHash = await sha256Hex(contents);
    if (contents.byteLength !== entry.byteLength || downloadedHash !== entry.sha256) {
      throw fail(DELIVERY_ERRORS.VERIFY_FAILED, `文章「${safeFileName(entry.filename)}」下载内容与服务器记录不一致，未确认保存。`);
    }

    // 用户要求：文章直接保存在所选文件夹根部，按问句命名，不建子文件夹。
    const saved = await localOutput.saveFile([], safeFileName(entry.filename), contents);
    if (saved.sha256 !== entry.sha256 || saved.byteLength !== entry.byteLength) {
      throw fail(DELIVERY_ERRORS.VERIFY_FAILED, `文章「${safeFileName(entry.filename)}」写盘内容与服务器记录不一致，未确认保存。`);
    }

    const record = {artifactId, requestId, sha256: entry.sha256, byteLength: entry.byteLength, queuedAt: Date.now()};
    await outbox.set(OUTBOX_PREFIX + artifactId, record);
    return sendReceipt(record);
  }

  async function sendReceipt(record) {
    const data = await api(`artifacts/${encodeURIComponent(record.artifactId)}/local-receipt`,
      {requestId: record.requestId, sha256: record.sha256, byteLength: record.byteLength});
    await outbox.delete(OUTBOX_PREFIX + record.artifactId);
    // 服务器唤醒批次后把最新状态交给 UI（receiveBatch），驱动等待保存 → 完成。
    if (data?.batch) onBatch(data.batch);
    return data?.receipt ?? data;
  }

  // outbox 补确认：网络失败保留记录下次重试；404（文章已不存在）丢弃陈旧记录。
  async function flushOutbox() {
    let delivered = 0;
    const failed = [];
    for (const key of await outbox.keys()) {
      if (!String(key).startsWith(OUTBOX_PREFIX)) continue;
      const record = await outbox.get(key);
      if (!record) { await outbox.delete(key); continue; }
      try {
        await sendReceipt(record);
        delivered += 1;
      } catch (error) {
        if (error?.status === 404) await outbox.delete(key);
        else failed.push({artifactId: record.artifactId, error});
      }
    }
    return {delivered, failed};
  }

  async function refreshPending({limit = 20, cursor = null} = {}) {
    const params = new URLSearchParams({limit: String(limit)});
    if (cursor) params.set('cursor', cursor);
    const page = await api(`artifacts/pending?${params}`);
    pendingCount = Number(page.items?.length ?? 0) + (page.nextCursor ? 1 : 0);
    notify();
    return page;
  }

  return {
    setScope(next) { scope = next; if (!next) { pendingCount = null; notify(); } },
    get pendingCount() { return pendingCount; },

    // 刷新待补存数量；先补确认 outbox（可能让部分文章脱离 pending）。
    async sync() {
      const flushed = await flushOutbox();
      const page = await refreshPending();
      return {...flushed, pending: pendingCount, page};
    },

    // 逐篇交付当前清单；单项失败不阻塞后续。返回 {delivered, failed:[{artifactId,error}]}。
    // 忙碌时拒绝重入（返回 skipped），避免同一 artifact 并发写盘/回执。
    async deliverAll({limit = 20} = {}) {
      if (busy) return {delivered: 0, failed: [], skipped: true};
      requireScope();
      busy = true;
      try {
        const flushed = await flushOutbox();
        const page = await refreshPending({limit});
        const failed = [...flushed.failed];
        let delivered = flushed.delivered;
        for (const entry of page.items ?? []) {
          try {
            await deliverOne(entry);
            delivered += 1;
          } catch (error) {
            failed.push({artifactId: String(entry.artifactId), code: error?.code, error});
          }
        }
        await refreshPending({limit});
        return {delivered, failed};
      } finally { busy = false; }
    },

    // 批次到达 awaiting_save 时的静默尝试：仅在目录已授权时自动写盘，失败不打扰。
    async autoDeliver() {
      const state = await localOutput.state();
      if (!state.supported || !state.directoryName || state.permission !== 'granted') return null;
      return this.deliverAll();
    },
  };
}
