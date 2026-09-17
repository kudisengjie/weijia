"""Real-endpoint verification for model providers and IMA.

Reads credentials from .local/verify-keys.json (gitignored). The file is
produced by exporting Windows user environment variables
(DEEPSEEK_API_KEY, HunYuan_API_KEY, AGNES_API_KEY, IMA_OPENAPI_CLIENTID,
IMA_OPENAPI_APIKEY) and must be deleted after verification.

Each check sends exactly one minimal request (test=True caps completion at
128 tokens). No secrets are printed; results contain status only.
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "cloud-functions"))

from geo_backend.errors import ApiError
from geo_backend.ima import ima_post, normalize
from geo_backend.models import model_selection
from geo_backend.providers import complete

KEYS_PATH = ROOT / ".local" / "verify-keys.json"


async def check_model(results: list[dict[str, object]], provider: str, slot: str, env_name: str) -> None:
    model = model_selection(provider, slot)
    key = str(json.loads(KEYS_PATH.read_text(encoding="utf-8")).get(env_name) or "").strip()
    target = f"{provider}/{slot}"
    if not key:
        results.append({"target": target, "modelId": model["modelId"], "ok": False, "error": f"missing {env_name}"})
        return
    started = time.perf_counter()
    try:
        content = await complete(model, key, [{"role": "user", "content": "只回复两个字符：ok"}], test=True)
        results.append({
            "target": target,
            "modelId": model["modelId"],
            "ok": True,
            "reply_head": content[:12],
            "latency_ms": int((time.perf_counter() - started) * 1000),
        })
    except ApiError as error:
        results.append({
            "target": target,
            "modelId": model["modelId"],
            "ok": False,
            "code": getattr(error, "code", ""),
            "error": str(error),
            "latency_ms": int((time.perf_counter() - started) * 1000),
        })


async def check_ima(results: list[dict[str, object]]) -> None:
    values = json.loads(KEYS_PATH.read_text(encoding="utf-8"))
    credentials = {
        "clientId": str(values.get("IMA_OPENAPI_CLIENTID") or ""),
        "apiKey": str(values.get("IMA_OPENAPI_APIKEY") or ""),
    }
    started = time.perf_counter()
    try:
        data = await ima_post(
            credentials,
            "openapi/wiki/v1/search_knowledge_base",
            {"query": "copilot", "cursor": "", "limit": 20},
        )
        items = data.get("info_list", [])
        visible = any(normalize(item.get("name") or item.get("kb_name")) == "copilot" for item in items)
        results.append({
            "target": "ima/search_knowledge_base",
            "ok": visible,
            "copilotVisible": visible,
            "knowledgeBaseCount": len(items),
            "latency_ms": int((time.perf_counter() - started) * 1000),
        })
    except ApiError as error:
        results.append({
            "target": "ima/search_knowledge_base",
            "ok": False,
            "code": getattr(error, "code", ""),
            "error": str(error),
            "latency_ms": int((time.perf_counter() - started) * 1000),
        })


async def main() -> int:
    results: list[dict[str, object]] = []
    if not KEYS_PATH.exists():
        print(json.dumps({"ok": False, "error": ".local/verify-keys.json not found"}, ensure_ascii=False))
        return 1
    await check_model(results, "deepseek", "primary", "DEEPSEEK_API_KEY")
    await check_model(results, "deepseek", "secondary", "DEEPSEEK_API_KEY")
    await check_model(results, "hunyuan", "primary", "HunYuan_API_KEY")
    await check_model(results, "hunyuan", "secondary", "HunYuan_API_KEY")
    await check_ima(results)
    print(json.dumps({"results": results, "all_ok": all(item["ok"] for item in results)}, ensure_ascii=False, indent=2))
    return 0 if all(item["ok"] for item in results) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
