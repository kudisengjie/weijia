import { HttpError, textValue, seal } from './security.mjs';
import { requireAdmin } from './auth.mjs';
import { withLock } from './storage.mjs';

export const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
export async function imaPost(credentials, path, payload, fetcher = fetch) {
  if (!credentials.clientId || !credentials.apiKey) throw new HttpError(503, '共享 IMA 凭据尚未配置，请联系管理员。', 'IMA_REQUIRED');
  let response;
  try { response = await fetcher(`https://ima.qq.com/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'ima-openapi-clientid': credentials.clientId, 'ima-openapi-apikey': credentials.apiKey }, body: JSON.stringify(payload), signal: AbortSignal.timeout(25000), redirect: 'error' }); }
  catch { throw new HttpError(502, 'IMA 连接失败，未自动重试。', 'IMA_NETWORK'); }
  if (!response.ok) throw new HttpError(502, `IMA 请求失败（HTTP ${response.status}）。`, 'IMA_ERROR');
  let result; try { result = await response.json(); } catch { throw new HttpError(502, 'IMA 返回格式错误。'); }
  if (result.code !== 0 || !result.data) throw new HttpError(502, `IMA 凭据、权限或请求异常（代码 ${Number(result.code) || '未知'}），请检查有效期。`, 'IMA_ERROR');
  return result.data;
}
export function nextCursor(data, current = '') {
  if (data.is_end === true) return null;
  if (typeof data.next_cursor !== 'string' || !data.next_cursor || data.next_cursor === current) throw new HttpError(502, 'IMA 分页信息异常，已停止以避免重复读取。');
  return data.next_cursor;
}
export async function updateIma(body, store, env, fetcher) {
  // Limit attempts across all sessions; a shared login is not administrator authority.
  const window = Math.floor(Date.now() / 900000); let allowed = false;
  for (let slot = 0; slot < 5; slot++) if (await store.create(`admin-attempts/${window}/${slot}`, { at: Date.now() })) { allowed = true; break; }
  if (!allowed) throw new HttpError(429, '管理员更新尝试过多，请稍后再试。');
  await requireAdmin(body, env);
  const value = { clientId: textValue(body.clientId, 'IMA Client ID', 4096), apiKey: textValue(body.apiKey, 'IMA API Key', 4096), expiresAt: textValue(body.expiresAt, '到期日期', 10), updatedAt: new Date().toISOString() };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.expiresAt) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) < Date.now() - 86400000) throw new HttpError(400, '请选择有效的未来到期日期。');
  if (/[\r\n\x00]/.test(value.clientId + value.apiKey)) throw new HttpError(400, 'IMA 凭据格式不正确。');
  return withLock(store, 'shared/ima-update-lock', async () => {
    const data = await imaPost(value, 'openapi/wiki/v1/search_knowledge_base', { query: 'copilot', cursor: '', limit: 20 }, fetcher);
    if (!(data.info_list || []).some(item => normalize(item.name || item.kb_name) === 'copilot')) throw new HttpError(422, '新凭据无法访问 copilot 知识库，已保留旧凭据。');
    await store.set('shared/ima', seal(value, env, 'shared/ima'));
    return { saved: true, expiresAt: value.expiresAt };
  });
}

export async function readMedia(credentials, media, fetcher = fetch) {
  const info = await imaPost(credentials, 'openapi/wiki/v1/get_media_info', { media_id: media.media_id }, fetcher);
  let text;
  if (info.media_type === 11 && info.notebook_ext_info?.notebook_id) {
    text = (await imaPost(credentials, 'openapi/note/v1/get_doc_content', { note_id: info.notebook_ext_info.notebook_id, target_content_format: 0 }, fetcher)).content;
  } else {
    let url; try { url = new URL(info.url_info?.url); } catch { throw new HttpError(422, `IMA 原文不可读：${media.title}，请在 IMA 中转换为 DOCX、PDF 或文本。`); }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !(url.hostname === 'ima.qq.com' || url.hostname.endsWith('.myqcloud.com'))) throw new HttpError(422, `IMA 原文下载域名不支持：${media.title}。请在 IMA 上传文件版本。`);
    const headers = info.url_info.headers || {};
    // Only scoped download credentials returned by IMA; never forward the owner API headers.
    if (Object.keys(headers).some(key => /ima-openapi|cookie|host/i.test(key))) throw new HttpError(502, 'IMA 下载响应包含不允许的请求头。');
    let response; try { response = await fetcher(url.href, { headers, redirect: 'error', signal: AbortSignal.timeout(25000) }); } catch { throw new HttpError(502, `IMA 原文下载失败：${media.title}。`); }
    if (!response.ok) throw new HttpError(502, `IMA 原文下载失败：${media.title}。`);
    const max = 20 * 1024 * 1024, chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > max) throw new HttpError(413, `IMA 原文超过 20 MB：${media.title}。`); chunks.push(chunk); }
    const buffer = Buffer.concat(chunks);
    if (buffer.subarray(0,4).toString() === '%PDF') {
      const pdfjs = await import('pdfjs-server/legacy/build/pdf.mjs');
      const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false });
      const pdf = await task.promise;
      try {
        if (pdf.numPages > 100) throw new HttpError(413, `IMA PDF 超过 100 页，请拆分：${media.title}。`);
        const parts = [];
        for (let p = 1; p <= pdf.numPages; p++) parts.push((await (await pdf.getPage(p)).getTextContent()).items.map(item => item.str || '').join(' '));
        text = parts.join('\n');
      } finally { await task.destroy(); }
    } else if (buffer[0] === 0x50 && buffer[1] === 0x4b && /\.docx$/i.test(media.title)) {
      const mammoth = await import('mammoth');
      text = (await mammoth.extractRawText({ buffer })).value;
    } else if (/\.(txt|md|markdown)$/i.test(media.title)) {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
      catch { text = new TextDecoder('gb18030', { fatal: true }).decode(buffer); }
    } else throw new HttpError(422, `IMA 原文格式暂不支持：${media.title}。请转为 DOCX、PDF、TXT 或 MD。`);
  }
  if (typeof text !== 'string' || !text.trim()) throw new HttpError(422, `IMA 原文为空或为扫描图片：${media.title}。`);
  if (text.length > 180000) throw new HttpError(413, `IMA 原文过长，请拆分：${media.title}。未使用截断内容。`);
  return { title: media.title, text: text.trim() };
}
