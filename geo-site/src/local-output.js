// 本地目录授权与安全写盘（阶段 B：仅目录授权/写盘验证，不启用生产文章删除）。
// 设计依据 docs/superpowers/plans/2026-09-16-glm-development-handoff.md §6。
// 依赖注入：storage（IndexedDB 适配）与 picker（目录选择器）可替换，便于在 Node 中
// 以 FSA 相同契约做真实磁盘验证；浏览器内使用 window.showDirectoryPicker 与 indexedDB。
import { sha256Hex } from './hash-bytes.js';

export const ERRORS = Object.freeze({
  NO_ACCOUNT_SCOPE: 'NO_ACCOUNT_SCOPE',
  PERMISSION_REQUIRED: 'PERMISSION_REQUIRED',
  WRITE_FAILED: 'WRITE_FAILED',
  CLOSE_FAILED: 'CLOSE_FAILED',
  VERIFY_FAILED: 'VERIFY_FAILED',
  UNSUPPORTED: 'DIRECTORY_PICKER_UNSUPPORTED',
});

const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const FORBIDDEN_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MAX_NAME_LENGTH = 80;

// 文件名只用于展示便利：去掉路径分隔符、控制字符、Windows 保留名、尾随空格/点。
// 绝不把服务端文件名直接当路径拼接，也不允许 ".." 越界。
export function safeFileName(name, fallback = 'article') {
  let text = typeof name === 'string' ? name.replace(FORBIDDEN_CHARS, '') : '';
  text = text.replace(/^\.+/, '').replace(/[. ]+$/g, '').trim();
  if (!text || RESERVED_NAMES.test(text)) text = fallback;
  if (text.length > MAX_NAME_LENGTH) text = text.slice(0, MAX_NAME_LENGTH).replace(/[. ]+$/g, '') || fallback;
  return text;
}

// 用户要求：文章按问句命名直接保存在所选文件夹根部，不再建子文件夹层级。
export function scopeKey(scope) {
  return `lxue.geo.dir.${scope}`;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// 默认本机存储：IndexedDB，键按服务端确认的 accountScope 隔离。
function defaultStorage() {
  if (typeof indexedDB === 'undefined') {
    return {
      async get() { return null; },
      async set() { throw fail(ERRORS.UNSUPPORTED, '当前环境没有可用的本机存储。'); },
      async delete() {},
    };
  }
  const DB_NAME = 'lxue-geo-local-output', STORE = 'handles';
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
      db.close;
    };
  });
  return {
    async get(key) {
      const {store, done} = await withStore('readonly');
      const value = await new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
      await done;
      return value ?? null;
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

export function createLocalOutput({storage, picker} = {}) {
  const usesDefaultPicker = !picker;
  if (!storage) storage = defaultStorage();
  const chooseDirectory = picker ?? (async () => window.showDirectoryPicker({mode: 'readwrite'}));
  let scope = null;
  let handle = null; // 当前账号内存中的目录句柄

  function requireScope() {
    if (!scope) throw fail(ERRORS.NO_ACCOUNT_SCOPE, '尚未确认登录账号，无法使用本地保存目录。');
    return scope;
  }

  async function permissionOf(target) {
    try {
      return await target.queryPermission({mode: 'readwrite'});
    } catch { return 'denied'; }
  }

  async function resolveDirectory(segments) {
    let current = handle;
    for (const segment of segments) current = await current.getDirectoryHandle(segment, {create: true});
    return current;
  }

  async function readHandleFile(directory, name) {
    const fileHandle = await directory.getFileHandle(name); // 不存在时抛 NotFoundError
    return fileHandle.getFile();
  }

  async function verifyReadBack(directory, name, expectedBytes, expectedHash) {
    const file = await readHandleFile(directory, name);
    if (file.size !== expectedBytes.byteLength) {
      throw fail(ERRORS.VERIFY_FAILED, `文件写盘后读回大小不一致（${file.size} ≠ ${expectedBytes.byteLength}），未确认保存。`);
    }
    const buffer = await file.arrayBuffer();
    const actual = await sha256Hex(buffer);
    if (actual !== expectedHash) {
      throw fail(ERRORS.VERIFY_FAILED, '文件写盘后读回内容不一致（SHA-256 不匹配），未确认保存。');
    }
  }

  return {
    async setScope(next) {
      if (next !== scope) { handle = null; }
      scope = next;
    },

    async state() {
      const supported = usesDefaultPicker
        ? typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
        : true;
      return {
        supported,
        scope,
        directoryName: handle ? handle.name : null,
        permission: handle ? await permissionOf(handle) : null,
      };
    },

    // 必须由用户点击按钮（手势）触发；系统对话框被取消时返回 {cancelled:true}。
    async pick() {
      requireScope();
      if (handle) return {name: handle.name};
      if (usesDefaultPicker && (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function')) {
        throw fail(ERRORS.UNSUPPORTED, '当前浏览器不支持自动保存到本地目录，请使用最新版 Edge 或 Chrome。');
      }
      let directory;
      try {
        directory = await chooseDirectory();
      } catch (error) {
        if (error && error.name === 'AbortError') return {cancelled: true};
        throw error;
      }
      handle = directory;
      await storage.set(scopeKey(scope), {name: directory.name, handle: directory, savedAt: Date.now()});
      return {name: directory.name};
    },

    // 登录后恢复本机已授权目录；句柄不存在或已失效时返回空状态。
    async restore() {
      if (!scope) return {name: null, permission: null};
      if (!handle) {
        const stored = await storage.get(scopeKey(scope));
        if (stored?.handle) handle = stored.handle;
      }
      if (!handle) return {name: null, permission: null};
      return {name: handle.name, permission: await permissionOf(handle)};
    },

    // 恢复句柄后需要再次授权时，由用户点击触发。
    async requestAccess() {
      if (!handle) throw fail(ERRORS.PERMISSION_REQUIRED, '请先选择保存文件夹。');
      const result = await handle.requestPermission({mode: 'readwrite'});
      return result === 'granted' ? 'granted' : 'denied';
    },

    // 只忘记本机设置与句柄，不删除用户已保存的任何文件。
    async forget() {
      if (scope) await storage.delete(scopeKey(scope));
      handle = null;
    },

    // 完整写盘链路：权限 → 逐级建目录 → 同名冲突处理 → 写入 → close → 读回校验。
    // 返回 {fileName, byteLength, sha256, reused?}；任何一步失败都不视为已保存。
    async saveFile(segments, fileName, contents) {
      requireScope();
      if (!handle) throw fail(ERRORS.PERMISSION_REQUIRED, '请先在“文章保存”中选择本地文件夹。');
      if ((await permissionOf(handle)) !== 'granted') {
        throw fail(ERRORS.PERMISSION_REQUIRED, '本机文件夹授权已失效，请重新授权后再保存。');
      }
      const expectedHash = await sha256Hex(contents);
      const directory = await resolveDirectory(segments);
      const safe = safeFileName(fileName);
      const dot = safe.lastIndexOf('.');
      const stem = dot > 0 ? safe.slice(0, dot) : safe;
      const extension = dot > 0 ? safe.slice(dot) : '';

      // 同名文件：读回哈希一致则复用不重写；不一致则另建冲突名，禁止覆盖用户修改过的文章。
      let target = safe;
      let nameTaken = false;
      try {
        const existing = await readHandleFile(directory, safe);
        const buffer = await existing.arrayBuffer();
        if (await sha256Hex(buffer) === expectedHash) {
          return {fileName: safe, byteLength: existing.size, sha256: expectedHash, reused: true};
        }
        nameTaken = true;
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
      }
      for (let attempt = 1; nameTaken; attempt += 1) {
        const candidate = `${stem}-conflict-${attempt}${extension}`;
        try {
          const existing = await readHandleFile(directory, candidate);
          const buffer = await existing.arrayBuffer();
          if (await sha256Hex(buffer) === expectedHash) {
            return {fileName: candidate, byteLength: existing.size, sha256: expectedHash, reused: true};
          }
          continue; // 冲突名也被占用且内容不同，继续尝试下一个序号
        } catch (error) {
          if (error?.name !== 'NotFoundError') throw error;
          target = candidate; // 冲突名空闲
          break;
        }
      }
      let writable;
      try {
        const fileHandle = await directory.getFileHandle(target, {create: true});
        writable = await fileHandle.createWritable();
        await writable.write(contents);
      } catch (error) {
        throw fail(ERRORS.WRITE_FAILED, `写入本地文件失败：${error?.message || error}`);
      }
      try {
        await writable.close();
      } catch (error) {
        throw fail(ERRORS.CLOSE_FAILED, `本地文件保存未完成（close 失败）：${error?.message || error}`);
      }
      await verifyReadBack(directory, target, contents, expectedHash);
      return {fileName: target, byteLength: contents.byteLength, sha256: expectedHash};
    },
  };
}
