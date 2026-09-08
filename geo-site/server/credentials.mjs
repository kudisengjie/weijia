import { HttpError, seal, unseal, textValue } from './security.mjs';
import { modelSelection } from './providers.mjs';
import { MODEL_PROVIDER_IDS } from '../src/model-switch.js';
import { withLock } from './storage.mjs';

export const ownerPrefix = session => `owners/${session.id}`;
export async function loadSettings(store, env, session) {
  const path = `${ownerPrefix(session)}/settings`;
  const value = await store.get(path);
  return value ? unseal(value, env, path) : { model: modelSelection('deepseek', 'primary'), keys: {} };
}
export async function saveModel(body, store, env, session) {
  const model = modelSelection(body.provider, body.slot, body.modelId);
  const key = textValue(body.apiKey ?? '', 'API Key', 4096, false);
  if (/[\r\n\x00]/.test(key)) throw new HttpError(400, 'API Key 格式不正确。');
  const path = `${ownerPrefix(session)}/settings`;
  return withLock(store, `${path}-lock`, async () => {
    const value = await loadSettings(store, env, session);
    value.model = model;
    if (body.removeKey === true) delete value.keys[model.id];
    else if (key) value.keys[model.id] = key;
    await store.set(path, seal(value, env, path));
    return { saved: true };
  });
}
export async function imaCredentials(store, env) {
  const value = await store.get('shared/ima');
  if (value) return unseal(value, env, 'shared/ima');
  return { clientId: env.IMA_OPENAPI_CLIENTID || '', apiKey: env.IMA_OPENAPI_APIKEY || '', expiresAt: '', updatedAt: null };
}
export async function publicSettings(store, env, session) {
  const settings = await loadSettings(store, env, session), ima = await imaCredentials(store, env);
  return { model: settings.model, providers: Object.fromEntries(MODEL_PROVIDER_IDS.map(id => [id, { configured: Boolean(settings.keys[id]) }])),
    ima: { configured: Boolean(ima.clientId && ima.apiKey), expiresAt: ima.expiresAt, updatedAt: ima.updatedAt }, expiresAt: session.expiresAt };
}
