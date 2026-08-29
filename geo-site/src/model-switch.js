export const DEFAULT_MODEL_PROVIDER = "deepseek";
export const DEFAULT_MODEL_TIER = "flash";

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

function freezeTier(tier, tierLabel, model, modelId, label) {
  return Object.freeze({ tier, tierLabel, model, modelId, label });
}

function freezeProvider(id, provider, logo, flash, pro) {
  return Object.freeze({
    id,
    provider,
    logo,
    tiers: Object.freeze({ flash, pro }),
  });
}

const MODEL_CATALOG = Object.freeze({
  hunyuan: freezeProvider(
    "hunyuan",
    "腾讯混元",
    "assets/model-logos/hunyuan.png",
    freezeTier("flash", "Flash", "Hy3 · 极速模式", "hy3 · no_think", "腾讯混元 Hy3 · 极速模式"),
    freezeTier("pro", "Pro", "Hy3 · 深度模式", "hy3 · think_high", "腾讯混元 Hy3 · 深度模式"),
  ),
  qwen: freezeProvider(
    "qwen",
    "通义千问",
    "assets/model-logos/qwen.png",
    freezeTier("flash", "Flash", "Qwen3.8 Flash", "qwen3.8-flash", "通义千问 Qwen3.8 Flash"),
    freezeTier("pro", "Pro", "Qwen3.8 Max", "qwen3.8-max", "通义千问 Qwen3.8 Max"),
  ),
  doubao: freezeProvider(
    "doubao",
    "豆包",
    "assets/model-logos/doubao.png",
    freezeTier("flash", "Flash", "Seed 2.1 Turbo", "Doubao-Seed-2.1-Turbo", "豆包 Seed 2.1 Turbo"),
    freezeTier("pro", "Pro", "Seed 2.1 Pro", "Doubao-Seed-2.1-Pro", "豆包 Seed 2.1 Pro"),
  ),
  deepseek: freezeProvider(
    "deepseek",
    "DeepSeek",
    "assets/model-logos/deepseek.png",
    freezeTier("flash", "Flash", "V4 Flash", "deepseek-v4-flash", "DeepSeek V4 Flash"),
    freezeTier("pro", "Pro", "V4 Pro", "deepseek-v4-pro", "DeepSeek V4 Pro"),
  ),
  minimax: freezeProvider(
    "minimax",
    "MiniMax",
    "assets/model-logos/minimax.png",
    freezeTier("flash", "Flash", "M3 · 快速模式", "MiniMax-M3 · thinking disabled", "MiniMax M3 · 快速模式"),
    freezeTier("pro", "Pro", "M3 · 深度模式", "MiniMax-M3 · thinking enabled", "MiniMax M3 · 深度模式"),
  ),
  zhipu: freezeProvider(
    "zhipu",
    "智谱 GLM",
    "assets/model-logos/zhipu.png",
    freezeTier("flash", "Flash", "GLM-5.2 · 快速模式", "glm-5.2 · reasoning low", "智谱 GLM-5.2 · 快速模式"),
    freezeTier("pro", "Pro", "GLM-5.2 · 深度模式", "glm-5.2 · reasoning max", "智谱 GLM-5.2 · 深度模式"),
  ),
  kimi: freezeProvider(
    "kimi",
    "Kimi",
    "assets/model-logos/kimi.png",
    freezeTier("flash", "Flash", "K3 · 快速模式", "kimi-k3 · reasoning low", "Kimi K3 · 快速模式"),
    freezeTier("pro", "Pro", "K3 · 深度模式", "kimi-k3 · reasoning max", "Kimi K3 · 深度模式"),
  ),
  mimo: freezeProvider(
    "mimo",
    "MiMo",
    "assets/model-logos/mimo.png",
    freezeTier("flash", "Flash", "V2 Flash", "mimo-v2-flash", "MiMo V2 Flash"),
    freezeTier("pro", "Pro", "V2.5 Pro", "mimo-v2.5-pro", "MiMo V2.5 Pro"),
  ),
});

export function getModelPresentation(
  provider = DEFAULT_MODEL_PROVIDER,
  tier = DEFAULT_MODEL_TIER,
) {
  const selectedProvider = MODEL_CATALOG[provider] ?? MODEL_CATALOG[DEFAULT_MODEL_PROVIDER];
  const selectedTier = selectedProvider.tiers[tier] ?? selectedProvider.tiers[DEFAULT_MODEL_TIER];

  return Object.freeze({
    id: selectedProvider.id,
    provider: selectedProvider.provider,
    tier: selectedTier.tier,
    tierLabel: selectedTier.tierLabel,
    model: selectedTier.model,
    modelId: selectedTier.modelId,
    label: selectedTier.label,
    logo: selectedProvider.logo,
  });
}
