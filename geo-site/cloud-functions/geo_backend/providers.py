from __future__ import annotations

import httpx

from .errors import ApiError


ENDPOINTS = {
    "hunyuan": "https://tokenhub.tencentmaas.com/v1/chat/completions",
    "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    "doubao": "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    "deepseek": "https://api.deepseek.com/chat/completions",
    "minimax": "https://api.minimax.cn/v1/chat/completions",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "kimi": "https://api.moonshot.ai/v1/chat/completions",
    "mimo": "https://api.xiaomimimo.com/v1/chat/completions",
}

COMPLETION_LIMITS = {
    "hunyuan": 16384,
    "minimax": 65536,
    "kimi": 16384,
    "mimo": 32768,
}


async def complete(model: dict[str, str], key: str, messages: list[dict[str, str]], *, client=None, test: bool = False) -> str:
    if not key:
        raise ApiError(422, "请先在设置中填写所选模型的 API Key。", "MODEL_KEY_REQUIRED")
    payload: dict[str, object] = {"model": model["modelId"], "messages": messages, "stream": False}
    # 2048 instead of 128: reasoning models such as hy4-preview spend the whole
    # probe budget on reasoning_content (finish_reason=length), which made the
    # settings "test connection" button report a false failure.
    completion_limit = 2048 if test else COMPLETION_LIMITS.get(model["id"], 8192)
    if model["id"] in {"minimax", "kimi", "mimo"}:
        payload["max_completion_tokens"] = completion_limit
    else:
        payload["max_tokens"] = completion_limit
    if model["id"] == "qwen":
        payload["enable_thinking"] = False
    # GLM-5.3 rejects thinking {"type": "disabled"} with a request error, so zhipu
    # omits the switch entirely and keeps the provider default.
    if model["id"] in {"doubao", "deepseek"}:
        payload["thinking"] = {"type": "disabled"}
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}

    owned = client is None
    # 吕老师 2026-09-19 深度排查：httpx.Timeout(100.0) 单值会让 connect/read 各自等
    # 100 秒（最坏 200s），叠加落库后超过 EdgeOne 云函数 120s 上限 → 网关 504、
    # 步骤 claim 悬挂 150 秒。改为 connect 10s + 总读 90s，给提交留 30s 余量。
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=10.0), follow_redirects=False)
    try:
        response = await http.post(model.get("endpoint") or ENDPOINTS[model["id"]], headers=headers, json=payload)
    except httpx.TransportError:
        raise ApiError(502, "模型连接中断或超过 90 秒，结果不确定，未自动重试。", "MODEL_TIMEOUT")
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
    requested = model["modelId"]
    if not isinstance(returned, str) or (returned != requested and not returned.startswith(requested + "-")):
        raise ApiError(502, "提供商返回模型与所选模型不一致。", "MODEL_MISMATCH")
    return content.strip()
