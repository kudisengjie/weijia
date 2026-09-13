from __future__ import annotations

import httpx

from .errors import ApiError


ENDPOINTS = {
    "hunyuan": "https://tokenhub.tencentmaas.com/v1/chat/completions",
    "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    "doubao": "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    "deepseek": "https://api.deepseek.com/chat/completions",
    "minimax": "https://api.minimaxi.com/v1/chat/completions",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "kimi": "https://api.moonshot.cn/v1/chat/completions",
    "mimo": "https://api.xiaomimimo.com/v1/chat/completions",
}


async def complete(model: dict[str, str], key: str, messages: list[dict[str, str]], *, client=None, test: bool = False) -> str:
    if not key:
        raise ApiError(422, "请先在设置中填写所选模型的 API Key。", "MODEL_KEY_REQUIRED")
    payload: dict[str, object] = {"model": model["modelId"], "messages": messages, "stream": False, "max_tokens": 128 if test else 8192}
    if model["id"] == "qwen":
        payload["enable_thinking"] = False
    if model["id"] in {"doubao", "zhipu", "deepseek"}:
        payload["thinking"] = {"type": "disabled"}
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
    if model["id"] == "mimo":
        headers.pop("Authorization")
        headers["api-key"] = key

    owned = client is None
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(100.0), follow_redirects=False)
    try:
        response = await http.post(ENDPOINTS[model["id"]], headers=headers, json=payload)
    except httpx.TransportError:
        raise ApiError(502, "模型连接中断或超过 100 秒，结果不确定，未自动重试。", "MODEL_TIMEOUT")
    finally:
        if owned:
            await http.aclose()
    if not response.is_success:
        reason = "API Key 无效或没有权限" if response.status_code in {401, 403} else "额度不足或请求受限" if response.status_code == 429 else "模型 ID 不存在或账户未开通" if response.status_code == 404 else "提供商请求失败"
        raise ApiError(502, f"{model['provider']}：{reason}（HTTP {response.status_code}）。", "MODEL_ERROR")
    try:
        data = response.json()
    except ValueError:
        raise ApiError(502, "模型返回内容不是有效 JSON。", "MODEL_PROTOCOL_ERROR")
    choice = (data.get("choices") or [{}])[0]
    if choice.get("finish_reason") != "stop":
        raise ApiError(502, "模型内容未完整返回或要求额外工具调用，本次已停止。", "MODEL_INCOMPLETE")
    content = (choice.get("message") or {}).get("content")
    if not isinstance(content, str) or not content.strip():
        raise ApiError(502, "模型没有返回可用正文。", "MODEL_EMPTY")
    returned = data.get("model")
    if not isinstance(returned, str) or (returned != model["modelId"] and not returned.startswith(model["modelId"] + "-")):
        raise ApiError(502, "提供商返回模型与所选模型不一致。", "MODEL_MISMATCH")
    return content.strip()
