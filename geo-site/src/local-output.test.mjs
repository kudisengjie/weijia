import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {createLocalOutput, safeFileName, relativePath, scopeKey, ERRORS} =
  await import('./local-output.js');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const bytes = text => new TextEncoder().encode(text);

// —— FSA 语义的内存句柄，模拟浏览器 FileSystemDirectoryHandle 契约 ——
function fakeWritable(file, dir) {
  return {
    async write(chunk) {
      if (file.failWrite || dir.failWrites) throw new Error('disk full');
      file.pending = chunk;
    },
    async close() {
      if (file.failClose || dir.failCloses) throw new Error('close failed');
      file.data = file.pending;
      file.written = true;
    },
  };
}
function fakeFile(file, dir) {
  if (dir.corruptReads) {
    return {
      size: dir.corruptReads.byteLength,
      async arrayBuffer() { return dir.corruptReads.slice().buffer; },
    };
  }
  return {
    size: file.data?.byteLength ?? 0,
    async arrayBuffer() { return file.data?.slice().buffer ?? new ArrayBuffer(0); },
  };
}
function fakeDir(name) {
  const dirs = new Map(), files = new Map();
  let permission = 'granted';
  const handle = {
    kind: 'directory', name, writeCount: 0,
    async queryPermission() { return permission; },
    async requestPermission() { permission = 'granted'; return permission; },
    deny() { permission = 'denied'; },
    async getDirectoryHandle(child, {create = false} = {}) {
      if (!dirs.has(child)) {
        if (!create) throw Object.assign(new Error('NotFoundError'), {name: 'NotFoundError'});
        const childDir = fakeDir(child);
        // 失败/篡改标志沿目录树传播，供注入失败场景使用。
        childDir.failWrites = handle.failWrites;
        childDir.failCloses = handle.failCloses;
        childDir.corruptReads = handle.corruptReads;
        dirs.set(child, childDir);
      }
      return dirs.get(child);
    },
    async getFileHandle(child, {create = false} = {}) {
      if (!files.has(child)) {
        if (!create) throw Object.assign(new Error('NotFoundError'), {name: 'NotFoundError'});
        files.set(child, {data: null, pending: null, written: false});
      }
      return {
        kind: 'file', name: child,
        async createWritable() {
          const file = files.get(child);
          handle.writeCount += 1;
          return fakeWritable(file, handle);
        },
        async getFile() { return fakeFile(files.get(child), handle); },
        _file: files.get(child),
      };
    },
  };
  handle._dirs = dirs; handle._files = files;
  return handle;
}
function memoryStorage() {
  const map = new Map();
  return {
    async get(key) { return map.get(key) ?? null; },
    async set(key, value) { map.set(key, value); },
    async delete(key) { map.delete(key); },
    _map: map,
  };
}
function output({storage = memoryStorage(), picker} = {}) {
  return createLocalOutput({
    storage,
    picker: picker ?? (async () => fakeDir('资料输出')),
  });
}

test('safe file names strip separators, reserved names and control characters', () => {
  assert.equal(safeFileName('品牌-A.md'), '品牌-A.md');
  assert.equal(safeFileName('a/b\\c:d*e?f"g<h>i|j.md'), 'abcdefghij.md');
  assert.equal(safeFileName('  结尾空格与点... '), '结尾空格与点');
  assert.equal(safeFileName('CON'), 'article');
  assert.equal(safeFileName('com1'), 'article');
  assert.equal(safeFileName(''), 'article');
  assert.equal(safeFileName('..\x00evil'), 'evil');
  assert.equal(safeFileName('x'.repeat(200)).length <= 80, true);
  assert.doesNotMatch(safeFileName('..'), /^\.+$/);
});

test('relative path nests 零雪GEO, scope, workspace and batch segments', () => {
  assert.deepEqual(
    relativePath({accountScope: 'a'.repeat(32), workspaceId: 'ws-1', batchId: 'b-1'}),
    ['零雪GEO', 'a'.repeat(32), 'ws-1', 'b-1'],
  );
  assert.equal(scopeKey('a'.repeat(32)), 'lxue.geo.dir.' + 'a'.repeat(32));
});

test('picked directory is reused within the same account scope', async () => {
  let picks = 0;
  const local = output({picker: async () => {picks += 1; return fakeDir('文章输出');}});
  await local.setScope('a'.repeat(32));
  const picked = await local.pick();
  assert.equal(picked.cancelled, undefined);
  assert.equal(picked.name, '文章输出');
  const again = await local.restore();
  assert.equal(again.name, '文章输出');
  assert.equal(again.permission, 'granted');
  assert.equal(picks, 1, 'restore must reuse the stored handle without re-picking');
});

test('declining the system dialog is a cancellation, not an error', async () => {
  const local = output({picker: async () => {throw Object.assign(new Error('user cancelled'), {name: 'AbortError'});}});
  await local.setScope('a'.repeat(32));
  const result = await local.pick();
  assert.equal(result.cancelled, true);
  assert.equal((await local.state()).directoryName, null);
});

test('revoked permission blocks writing until re-granted', async () => {
  const handle = fakeDir('文章输出');
  const local = output({picker: async () => handle});
  await local.setScope('a'.repeat(32));
  await local.pick();
  handle.deny();
  const restored = await local.restore();
  assert.equal(restored.permission, 'denied');
  await assert.rejects(
    () => local.saveFile(['seg'], 'a.md', bytes('x')),
    error => error.code === ERRORS.PERMISSION_REQUIRED,
  );
  assert.equal(await local.requestAccess(), 'granted');
  const saved = await local.saveFile(['seg'], 'a.md', bytes('x'));
  assert.equal(saved.fileName, 'a.md');
});

test('write failure leaves no file and no confirmation', async () => {
  const handle = fakeDir('文章输出');
  const local = output({picker: async () => handle});
  await local.setScope('a'.repeat(32));
  await local.pick();
  handle.failWrites = true; // 整个目录写入阶段失败
  await assert.rejects(
    () => local.saveFile(['seg'], 'a.md', bytes('content')),
    error => error.code === ERRORS.WRITE_FAILED,
  );
  assert.equal(handle._files.size, 0, 'failed write must not leave a file entry');
});

test('close failure is surfaced and does not confirm delivery', async () => {
  const handle = fakeDir('文章输出');
  const local = output({picker: async () => handle});
  await local.setScope('a'.repeat(32));
  await local.pick();
  handle.failCloses = true;
  await assert.rejects(
    () => local.saveFile(['seg'], 'a.md', bytes('content')),
    error => error.code === ERRORS.CLOSE_FAILED,
  );
});

test('read-back mismatch fails verification instead of confirming', async () => {
  const handle = fakeDir('文章输出');
  const local = output({picker: async () => handle});
  await local.setScope('a'.repeat(32));
  await local.pick();
  // 写入成功但读回内容被篡改：close 后读回与期望不一致
  handle.corruptReads = bytes('tampered');
  await assert.rejects(
    () => local.saveFile(['seg'], 'a.md', bytes('content')),
    error => error.code === ERRORS.VERIFY_FAILED,
  );
});

test('identical content reuses the existing file; different content goes to a conflict name', async () => {
  const handle = fakeDir('文章输出');
  const local = output({picker: async () => handle});
  await local.setScope('a'.repeat(32));
  await local.pick();
  const seg = ['零雪GEO', 'a'.repeat(32), 'ws', 'b'];
  const first = await local.saveFile(seg, '001-品牌.md', bytes('v1'));
  assert.equal(first.fileName, '001-品牌.md');
  const writesAfterFirst = handle.writeCount;

  const same = await local.saveFile(seg, '001-品牌.md', bytes('v1'));
  assert.equal(same.reused, true);
  assert.equal(handle.writeCount, writesAfterFirst, 'identical file must not be rewritten');

  const conflict = await local.saveFile(seg, '001-品牌.md', bytes('v2-changed'));
  assert.equal(conflict.fileName, '001-品牌-conflict-1.md');
  // 原文件内容未被覆盖
  let node = handle;
  for (const part of seg) node = await node.getDirectoryHandle(part);
  const original = await node.getFileHandle('001-品牌.md');
  assert.equal(sha256(Buffer.from(await (await original.getFile()).arrayBuffer())), sha256(bytes('v1')));
});

test('switching account scope isolates handles and keeps the old scope stored', async () => {
  const storage = memoryStorage();
  let pickerScope = null;
  const handles = new Map();
  const local = output({
    storage,
    picker: async () => {
      const handle = fakeDir(`dir-for-${pickerScope}`);
      handles.set(pickerScope, handle);
      return handle;
    },
  });
  pickerScope = 'a'.repeat(32);
  await local.setScope(pickerScope);
  await local.pick();

  // 切到另一个账号：看不到 A 的目录，也不能用 A 的句柄写盘
  pickerScope = 'b'.repeat(32);
  await local.setScope(pickerScope);
  assert.equal((await local.state()).directoryName, null);
  await assert.rejects(() => local.saveFile(['s'], 'x.md', bytes('x')), error => error.code === ERRORS.PERMISSION_REQUIRED);

  // B 选择自己的目录，互不影响
  await local.pick();
  assert.equal((await local.state()).directoryName, 'dir-for-' + 'b'.repeat(32));

  // A 回来：句柄从本机存储恢复，不需要重新选择
  pickerScope = 'a'.repeat(32);
  await local.setScope(pickerScope);
  const restored = await local.restore();
  assert.equal(restored.name, 'dir-for-' + 'a'.repeat(32));
  assert.equal(restored.permission, 'granted');
});

test('forget removes only the stored handle, never user files', async () => {
  const storage = memoryStorage();
  const handle = fakeDir('文章输出');
  const local = output({storage, picker: async () => handle});
  await local.setScope('a'.repeat(32));
  await local.pick();
  await local.saveFile(['零雪GEO', 'a'.repeat(32), 'w', 'b'], 'a.md', bytes('keep me on disk'));
  await local.forget();
  assert.equal((await local.state()).directoryName, null);
  assert.equal(storage._map.size, 0);
  // 内存句柄中的文件仍在（只忘记设置，不删文件）
  let node = handle;
  for (const part of ['零雪GEO', 'a'.repeat(32), 'w', 'b']) node = await node.getDirectoryHandle(part);
  const file = await node.getFileHandle('a.md');
  assert.equal(file._file.written, true);
});

test('operating without an account scope is rejected', async () => {
  const local = output();
  await assert.rejects(() => local.pick(), error => error.code === ERRORS.NO_ACCOUNT_SCOPE);
  await assert.rejects(
    () => local.saveFile(['s'], 'a.md', bytes('x')),
    error => error.code === ERRORS.NO_ACCOUNT_SCOPE,
  );
  await local.setScope(null);
  await assert.rejects(() => local.pick(), error => error.code === ERRORS.NO_ACCOUNT_SCOPE);
});

// —— 真实磁盘验证：专用临时目录，走与浏览器完全相同的 saveFile 代码路径 ——
// （不是 OPFS/Blob 替身；写的是真实用户磁盘上的临时目录。）
function nodeFsHandle(root) {
  const ensureDir = relative => {
    const target = path.join(root, ...relative);
    fs.mkdirSync(target, {recursive: true});
    return target;
  };
  const makeFileHandle = (relative, name) => ({
    kind: 'file', name,
    async createWritable() {
      const target = path.join(root, ...relative, name);
      const stream = fs.createWriteStream(target, {flags: 'w'});
      const chunks = [];
      return {
        async write(chunk) { chunks.push(Buffer.from(chunk)); },
        async close() {
          await new Promise((resolve, reject) => {
            stream.end(Buffer.concat(chunks), resolve);
            stream.on('error', reject);
          });
        },
      };
    },
    async getFile() {
      const target = path.join(root, ...relative, name);
      const data = fs.readFileSync(target);
      return {
        size: data.byteLength,
        async arrayBuffer() { return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); },
      };
    },
  });
  const dirHandle = (relative) => ({
    kind: 'directory', name: relative.length ? relative[relative.length - 1] : path.basename(root),
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async getDirectoryHandle(child, {create = false} = {}) {
      const next = [...relative, child];
      if (create) fs.mkdirSync(path.join(root, ...next), {recursive: true});
      else if (!fs.existsSync(path.join(root, ...next))) {
        throw Object.assign(new Error('NotFoundError'), {name: 'NotFoundError'});
      }
      return dirHandle(next);
    },
    async getFileHandle(child, {create = false} = {}) {
      const next = [...relative, child];
      if (!fs.existsSync(path.join(root, ...next))) {
        if (!create) throw Object.assign(new Error('NotFoundError'), {name: 'NotFoundError'});
        fs.mkdirSync(path.join(root, ...relative), {recursive: true});
        fs.writeFileSync(path.join(root, ...next), '');
      }
      return makeFileHandle(relative, child);
    },
  });
  return dirHandle([]);
}

test('real disk round trip: write, close, read back and verify sha256 in a temp directory', async () => {
  const root = path.join(os.tmpdir(), `lxue-geo-phaseb-${Date.now()}-${process.pid}`);
  fs.mkdirSync(root, {recursive: true});
  try {
    const local = createLocalOutput({
      storage: memoryStorage(),
      picker: async () => nodeFsHandle(root),
    });
    await local.setScope('a'.repeat(32));
    await local.pick();
    const saved = await local.saveFile(
      ['零雪GEO', 'a'.repeat(32), 'ws-1', 'batch-1'], '001-品牌-artifact1.md', bytes('# 真实写盘验证\n\n内容一致。'),
    );
    assert.equal(saved.fileName, '001-品牌-artifact1.md');

    const written = path.join(root, '零雪GEO', 'a'.repeat(32), 'ws-1', 'batch-1', '001-品牌-artifact1.md');
    const onDisk = fs.readFileSync(written);
    assert.equal(sha256(onDisk), saved.sha256);
    assert.equal(onDisk.byteLength, saved.byteLength);
    assert.equal(saved.byteLength, bytes('# 真实写盘验证\n\n内容一致。').byteLength);

    // 真实磁盘上的同名复用与冲突
    const reuse = await local.saveFile(['零雪GEO', 'a'.repeat(32), 'ws-1', 'batch-1'], '001-品牌-artifact1.md', bytes('# 真实写盘验证\n\n内容一致。'));
    assert.equal(reuse.reused, true);
    const conflict = await local.saveFile(['零雪GEO', 'a'.repeat(32), 'ws-1', 'batch-1'], '001-品牌-artifact1.md', bytes('changed'));
    assert.equal(conflict.fileName, '001-品牌-artifact1-conflict-1.md');
    assert.equal(fs.readFileSync(written).toString(), '# 真实写盘验证\n\n内容一致。');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
