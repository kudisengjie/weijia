import { getModelPresentation, MODEL_PROVIDER_IDS } from '../src/model-switch.js';
import { HttpError, textValue } from './security.mjs';

export const ENDPOINTS = Object.freeze({
  hunyuan: 'https://tokenhub.tencentmaas.com/v1/chat/completions',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  minimax: 'https://api.minimaxi.com/v1/chat/completions',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  kimi: 'https://api.moonshot.cn/v1/chat/completions',
  mimo: 'https://api.xiaomimimo.com/v1/chat/completions',
});
export function modelSelection(provider, slot, modelId) {
  if (!MODEL_PROVIDER_IDS.includes(provider) || !['primary', 'secondary'].includes(slot)) throw new HttpError(400, '请选择支持的厂商与模型。');
  const selected = getModelPresentation(provider, slot);
  const id = modelId ? textValue(modelId, '模型 ID', 160) : selected.modelId;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(id)) throw new HttpError(400, '模型 ID 格式不正确。');
  return { ...selected, modelId: id, label: id === selected.modelId ? selected.label : `${selected.provider} · ${id}` };
}
export async function complete(model, key, messages, { fetcher = fetch, test = false } = {}) {
  if (!key) throw new HttpError(422, '请先在设置中填写所选模型的 API Key。', 'MODEL_KEY_REQUIRED');
  const payload = { model: model.modelId, messages, stream: false, max_tokens: test ? 128 : 8192 };
  if (model.id === 'qwen') payload.enable_thinking = false;
  if (model.id === 'doubao' || model.id === 'zhipu' || model.id === 'deepseek') payload.thinking = { type: 'disabled' };
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  if (model.id === 'mimo') { delete headers.Authorization; headers['api-key'] = key; }
  let response;
  try { response = await fetcher(ENDPOINTS[model.id], { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(100000), redirect: 'error' }); }
  catch { throw new HttpError(502, '模型连接中断或超过 100 秒，结果不确定，未自动重试。', 'MODEL_TIMEOUT'); }
  if (!response.ok) {
    const reason = response.status === 401 || response.status === 403 ? 'API Key 无效或没有权限' : response.status === 429 ? '额度不足或请求受限' : response.status === 404 ? '模型 ID 不存在或账户未开通' : '提供商请求失败';
    throw new HttpError(502, `${model.provider}：${reason}（HTTP ${response.status}）。`, 'MODEL_ERROR');
  }
  let data; try { data = await response.json(); } catch { throw new HttpError(502, '模型返回内容不是有效 JSON。', 'MODEL_PROTOCOL_ERROR'); }
  const choice = data.choices?.[0];
  if (choice?.finish_reason !== 'stop') throw new HttpError(502, '模型内容未完整返回或要求额外工具调用，本次已停止。', 'MODEL_INCOMPLETE');
  const content = choice.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new HttpError(502, '模型没有返回可用正文。', 'MODEL_EMPTY');
  // Never accept a silent change to a different model.
  if (!data.model || (data.model !== model.modelId && !data.model.startsWith(model.modelId + '-'))) throw new HttpError(502, '提供商返回模型与所选模型不一致。', 'MODEL_MISMATCH');
  return content.trim();
}
