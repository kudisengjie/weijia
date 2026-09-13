from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "cloud-functions"))

from geo_backend.errors import ApiError
from geo_backend.ima import ima_post, normalize


async def main() -> int:
    config_path = ROOT / ".local" / "edgeone-secrets.json"
    try:
        values = json.loads(config_path.read_text(encoding="utf-8"))
        credentials = {
            "clientId": values.get("IMA_OPENAPI_CLIENTID", ""),
            "apiKey": values.get("IMA_OPENAPI_APIKEY", ""),
        }
        data = await ima_post(
            credentials,
            "openapi/wiki/v1/search_knowledge_base",
            {"query": "copilot", "cursor": "", "limit": 20},
        )
        items = data.get("info_list", [])
        visible = any(normalize(item.get("name") or item.get("kb_name")) == "copilot" for item in items)
        print(json.dumps({"ok": visible, "copilotVisible": visible, "knowledgeBaseCount": len(items)}))
        return 0 if visible else 1
    except (ApiError, OSError, ValueError, TypeError) as error:
        print(json.dumps({"ok": False, "code": getattr(error, "code", "SMOKE_FAILED")}))
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
