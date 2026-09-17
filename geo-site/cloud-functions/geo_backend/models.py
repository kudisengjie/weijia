from __future__ import annotations

import re
from contextlib import nullcontext

from .errors import ApiError


MODEL_PROVIDER_IDS = ("hunyuan", "qwen", "doubao", "deepseek", "minimax", "zhipu", "kimi", "mimo")

CATALOG = {
    "hunyuan": {"provider": "腾讯混元", "primary": ("Hy3", "hy3"), "secondary": ("Hy4 Preview", "hy4-preview")},
    "qwen": {"provider": "通义千问", "primary": ("Qwen3.8 Flash", "qwen3.8-flash"), "secondary": ("Qwen3.8 Max", "qwen3.8-max")},
    "doubao": {"provider": "豆包", "primary": ("Seed 2.1 Turbo", "doubao-seed-2-1-turbo-260628"), "secondary": ("Seed 2.1 Pro", "doubao-seed-2-1-pro-260628")},
    "deepseek": {"provider": "DeepSeek", "primary": ("V4.1 Flash", "deepseek-flash"), "secondary": ("V4 Pro", "deepseek-v4-pro")},
    "minimax": {"provider": "MiniMax", "primary": ("M2.7", "MiniMax-M2.7"), "secondary": ("M3", "MiniMax-M3")},
    "zhipu": {"provider": "智谱 GLM", "primary": ("GLM-5.3 Flash", "glm-5.3-flash"), "secondary": ("GLM-5.3", "glm-5.3")},
    "kimi": {"provider": "Kimi", "primary": ("K2.7 Code", "kimi-k2.7-code"), "secondary": ("K3", "kimi-k3")},
    "mimo": {"provider": "Xiaomi MiMo", "primary": ("MiMo V2.5", "mimo-v2.5"), "secondary": ("MiMo V2.5 Pro", "mimo-v2.5-pro")},
}

_MODEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$")


def model_selection(provider: str, slot: str, model_id: str = "") -> dict[str, str]:
    if provider not in MODEL_PROVIDER_IDS or slot not in {"primary", "secondary"}:
        raise ApiError(400, "请选择支持的厂商与模型。")
    provider_data = CATALOG[provider]
    model, default_id = provider_data[slot]
    selected_id = str(model_id or default_id).strip()
    if len(selected_id) > 160 or not _MODEL_ID_RE.fullmatch(selected_id):
        raise ApiError(400, "模型 ID 格式不正确。")
    label = f"{provider_data['provider']} {model}" if selected_id == default_id else f"{provider_data['provider']} · {selected_id}"
    return {
        "id": provider,
        "provider": str(provider_data["provider"]),
        "slot": slot,
        "model": model,
        "modelId": selected_id,
        "label": label,
    }


class SettingsService:
    def __init__(self, repository: object, master_key: str) -> None:
        self.repository = repository
        self.master_key = master_key

    def private(self, user_id: str) -> dict[str, object]:
        rows = self.repository.load_model_settings(user_id, self.master_key)
        selected = next((row for row in rows if row["selected"]), None)
        model = model_selection(
            str(selected["provider"]) if selected else "deepseek",
            str(selected["slot"]) if selected else "primary",
            str(selected["model_id"]) if selected else "",
        )
        return {"model": model, "keys": {str(row["provider"]): row["api_key"] for row in rows if row.get("api_key")}}

    def public(self, user_id: str, ima: dict[str, object], session_expires_at: object = None) -> dict[str, object]:
        private = self.private(user_id)
        configured = {provider: {"configured": bool(private["keys"].get(provider))} for provider in MODEL_PROVIDER_IDS}
        return {
            "model": private["model"],
            "providers": configured,
            "ima": {
                "configured": bool(ima.get("clientId") and ima.get("apiKey")),
                "expiresAt": ima.get("expiresAt", ""),
                "updatedAt": ima.get("updatedAt"),
            },
            "expiresAt": session_expires_at,
        }

    def save_model(
        self,
        user_id: str,
        provider: str,
        slot: str,
        model_id: str,
        api_key: str,
        remove_key: bool,
    ) -> dict[str, object]:
        model = model_selection(provider, slot, model_id)
        key = str(api_key or "").strip()
        if len(key) > 4096 or any(char in key for char in "\r\n\x00"):
            raise ApiError(400, "API Key 格式不正确。")
        with self.repository.transaction() if hasattr(self.repository, 'transaction') else nullcontext():
            if hasattr(self.repository, 'lock_user'):
                self.repository.lock_user(user_id)
            if hasattr(self.repository, 'has_active_batch') and self.repository.has_active_batch(user_id):
                raise ApiError(409, '批次尚未结束，完成或取消后才能切换模型。', 'MODEL_LOCKED_DURING_BATCH')
            self.repository.save_model(user_id, model, key or None, remove_key is True, self.master_key)
        return {"saved": True}
