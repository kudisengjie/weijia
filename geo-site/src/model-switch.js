export const DEFAULT_MODEL_PROVIDER = "agnes";

const MODEL_PRESENTATIONS = Object.freeze({
  agnes: Object.freeze({
    id: "agnes",
    provider: "Agnes",
    model: "2.5 Flash",
    label: "Agnes 2.5 Flash",
  }),
  deepseek: Object.freeze({
    id: "deepseek",
    provider: "DeepSeek",
    model: "V4 Flash",
    label: "DeepSeek V4 Flash",
  }),
});

export function getModelPresentation(provider = DEFAULT_MODEL_PROVIDER) {
  return MODEL_PRESENTATIONS[provider] ?? MODEL_PRESENTATIONS[DEFAULT_MODEL_PROVIDER];
}
