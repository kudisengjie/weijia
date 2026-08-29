export const DEFAULT_MODEL_PROVIDER = "deepseek";
export const DEFAULT_MODEL_SLOT = "primary";

export const MODEL_PROVIDER_IDS = Object.freeze([
  "hunyuan",
  "qwen",
  "doubao",
  "deepseek",
  "minimax",
  "zhipu",
  "kimi",
  "mimo",
]);

function freezeModel(slot, model, modelId, label) {
  return Object.freeze({ slot, model, modelId, label });
}

function freezeProvider(id, provider, logo, primary, secondary) {
  return Object.freeze({
    id,
    provider,
    logo,
    models: Object.freeze({ primary, secondary }),
  });
}

const MODEL_CATALOG = Object.freeze({
  hunyuan: freezeProvider(
    "hunyuan",
    "腾讯混元",
    "assets/model-logos/hunyuan.png",
    freezeModel("primary", "Hy3", "hy3", "腾讯混元 Hy3"),
    freezeModel("secondary", "Hy4 Preview", "hy4-preview", "腾讯混元 Hy4 Preview"),
  ),
  qwen: freezeProvider(
    "qwen",
    "通义千问",
    "assets/model-logos/qwen.png",
    freezeModel("primary", "Qwen3.8 Flash", "qwen3.8-flash", "通义千问 Qwen3.8 Flash"),
    freezeModel("secondary", "Qwen3.8 Max", "qwen3.8-max", "通义千问 Qwen3.8 Max"),
  ),
  doubao: freezeProvider(
    "doubao",
    "豆包",
    "assets/model-logos/doubao.png",
    freezeModel("primary", "Seed 2.0 Lite", "doubao-seed-2-0-lite-260215", "豆包 Seed 2.0 Lite"),
    freezeModel("secondary", "Seed 2.0 Pro", "doubao-seed-2-0-pro-260215", "豆包 Seed 2.0 Pro"),
  ),
  deepseek: freezeProvider(
    "deepseek",
    "DeepSeek",
    "assets/model-logos/deepseek.png",
    freezeModel("primary", "V4 Flash", "deepseek-v4-flash", "DeepSeek V4 Flash"),
    freezeModel("secondary", "V4 Pro", "deepseek-v4-pro", "DeepSeek V4 Pro"),
  ),
  minimax: freezeProvider(
    "minimax",
    "MiniMax",
    "assets/model-logos/minimax.png",
    freezeModel("primary", "M2.7", "MiniMax-M2.7", "MiniMax M2.7"),
    freezeModel("secondary", "M3", "MiniMax-M3", "MiniMax M3"),
  ),
  zhipu: freezeProvider(
    "zhipu",
    "智谱 GLM",
    "assets/model-logos/zhipu.png",
    freezeModel("primary", "GLM-5.3 Flash", "glm-5.3-flash", "智谱 GLM-5.3 Flash"),
    freezeModel("secondary", "GLM-5.3", "glm-5.3", "智谱 GLM-5.3"),
  ),
  kimi: freezeProvider(
    "kimi",
    "Kimi",
    "assets/model-logos/kimi.png",
    freezeModel("primary", "K2.7 Code", "kimi-k2.7-code", "Kimi K2.7 Code"),
    freezeModel("secondary", "K3", "kimi-k3", "Kimi K3"),
  ),
  mimo: freezeProvider(
    "mimo",
    "Xiaomi MiMo",
    "assets/model-logos/mimo.png",
    freezeModel("primary", "MiMo V2.5", "mimo-v2.5", "Xiaomi MiMo V2.5"),
    freezeModel("secondary", "MiMo V2.5 Pro", "mimo-v2.5-pro", "Xiaomi MiMo V2.5 Pro"),
  ),
});

export function getModelPresentation(
  provider = DEFAULT_MODEL_PROVIDER,
  slot = DEFAULT_MODEL_SLOT,
) {
  const selectedProvider = MODEL_CATALOG[provider] ?? MODEL_CATALOG[DEFAULT_MODEL_PROVIDER];
  const selectedModel = selectedProvider.models[slot] ?? selectedProvider.models[DEFAULT_MODEL_SLOT];

  return Object.freeze({
    id: selectedProvider.id,
    provider: selectedProvider.provider,
    slot: selectedModel.slot,
    model: selectedModel.model,
    modelId: selectedModel.modelId,
    label: selectedModel.label,
    logo: selectedProvider.logo,
  });
}
