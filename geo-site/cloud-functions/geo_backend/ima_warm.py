"""主账号手动触发的 IMA 缓存更新获取（吕老师 2026-09-18 需求；分批续跑版）。

只获取两个知识库：
- copilot：全部内容（递归遍历所有文件夹并读取全部文件正文），供生成/审核规则与记忆文档使用；
- GEO优化知识库：仅获取列表（知识库列仅作展示，不读取文件正文）。

分批设计（2026-09-18 真实部署发现：单请求全量抓取正文耗时过长，会撞 EdgeOne
网关执行时限，返回非 JSON 导致前端误报"运行接口未部署"）：
- start=True：bump generation（旧代缓存整体失效），随后把知识库列表与目录清单
  强制刷新写入新代；这些列表类条目体积小、调用少，单次请求内可完成；
- 文件正文每次调用最多拉取 max_files 个（get_or_fetch 不带 force：新代中缺失
  才真正下载，已拉取过的直接命中），未完成时返回 done=False，由前端循环续跑；
- 中途停止也不影响已写入新代的部分；再次点击继续，不会重复下载已完成的文件。
缓存键与 BatchService 的 cached_post/cached_media 完全一致，
任务运行时可直接命中这里预热好的缓存，不再重复调用 IMA 上游。
"""
from __future__ import annotations

import httpx

from .errors import ApiError
from .ima import ImaCache, ima_post, next_cursor, normalize, read_media

GEO_KB_NAME = "GEO优化知识库"
MAX_BASES = 400
MAX_COPILOT_FILES = 500
MAX_FOLDERS = 100
DEFAULT_MAX_FILES_PER_CALL = 20


def _media(raw: dict[str, object]) -> dict[str, object]:
    """与 BatchService._media 保持一致的条目规范化。"""
    media_id = raw.get("media_id") or raw.get("folder_id")
    title = raw.get("title") or raw.get("name")
    if not isinstance(media_id, str) or not isinstance(title, str):
        raise ApiError(502, "IMA 文件信息不完整。")
    folder = bool(raw.get("folder_id")) or media_id.startswith("folder_")
    return {"media_id": media_id, "title": title, "media_type": 99 if folder else raw.get("media_type")}


async def warm_ima_cache(
    repository: object,
    credentials: dict[str, object],
    master_key: str,
    *,
    client: httpx.AsyncClient | None = None,
    start: bool = False,
    user_id: str | None = None,
    max_files: int = DEFAULT_MAX_FILES_PER_CALL,
) -> dict[str, object]:
    cache = ImaCache(repository, master_key)
    http = client if client is not None else httpx.AsyncClient(timeout=60)
    owned_client = client is None
    generation = int(repository.clear_ima_cache_generation(user_id)) if start else int(repository.get_ima_cache_generation())
    result: dict[str, object] = {
        "done": True, "bases": 0, "copilotTotal": 0, "geoListed": 0,
        "fetchedThisCall": 0, "warnings": [], "generation": generation,
    }
    # 列表类（知识库目录/文件清单）：start 时强制刷新写入新代；续跑时读新代缓存，
    # 不再重复打上游。文件正文永远不带 force：新代缺失才真正下载（天然续跑）。
    list_force = bool(start)

    async def fetch_list(kind: str, payload: dict[str, object], path: str, label: str | None = None) -> dict[str, object]:
        return await cache.get_or_fetch(
            kind,
            {**payload, "endpoint": path},
            lambda: ima_post(credentials, path, payload, client=http),
            allow_fetch=True,
            force_refresh=list_force,
            label=label,
        )

    async def ensure_media(kb_id: str, media: dict[str, object]) -> dict[str, str] | None:
        """返回 None 表示该文件已在本代缓存中（跳过不下载）；否则执行获取并返回正文。"""
        request = {"knowledgeBaseId": kb_id, "mediaId": media["media_id"]}
        cache_key = ImaCache.key("media", request, generation)
        if repository.get_ima_cache("media", cache_key, generation, master_key) is not None:
            return None
        return await cache.get_or_fetch(
            "media",
            request,
            lambda: read_media(credentials, {**media, "kbId": kb_id}, client=http),
            allow_fetch=True,
            force_refresh=False,
            label=f"文件正文 · {media['title']}",
        )

    try:
        # 第一段：分页扫描全部知识库（与批次的 bases 阶段同一缓存键）。
        bases: list[dict[str, object]] = []
        cursor = ""
        while True:
            data = await fetch_list(
                "search", {"query": "", "cursor": cursor, "limit": 20}, "openapi/wiki/v1/search_knowledge_base",
                label=f"知识库列表扫描（第 {len(bases) // 20 + 1} 页）",
            )
            bases.extend(data.get("info_list", []))
            result["bases"] = len(bases)
            cursor = next_cursor(data, cursor)
            if cursor is None:
                break
            if len(bases) > MAX_BASES:
                raise ApiError(422, "知识库数量超过扫描上限，请联系管理员。")

        def find_base(name: str) -> str | None:
            matches = [item for item in bases if normalize(item.get("name") or item.get("kb_name")) == normalize(name)]
            if len(matches) != 1:
                result["warnings"].append(f"知识库「{name}」不存在或同名不唯一，已跳过。")
                return None
            base_id = matches[0].get("id") or matches[0].get("kb_id")
            if not base_id:
                result["warnings"].append(f"知识库「{name}」信息不完整，已跳过。")
                return None
            return str(base_id)

        copilot_id = find_base("copilot")
        if copilot_id is None:
            raise ApiError(422, "知识库「copilot」不存在或同名不唯一，请管理员检查 IMA。")
        geo_id = find_base(GEO_KB_NAME)

        # 第二段：copilot 目录递归 + 文件正文（每调用最多 max_files 个，未完成 done=False）。
        queue: list[dict[str, str]] = [{"folder": "", "cursor": ""}]
        visited: list[str] = []
        folder_names: dict[str, str] = {}
        total = 0

        done = True
        walk: list[tuple[str, dict[str, object]]] = []  # (folder_id, [条目]) 展开的清单
        while queue:
            job = queue[0]
            payload: dict[str, object] = {"knowledge_base_id": copilot_id, "cursor": job["cursor"], "limit": 50}
            if job["folder"]:
                payload["folder_id"] = job["folder"]
            folder_label = "copilot 目录清单 · 根目录" if not job["folder"] else f"copilot 目录清单 · {folder_names.get(job['folder'], job['folder'])}"
            data = await fetch_list("rules", payload, "openapi/wiki/v1/get_knowledge_list", label=folder_label)
            for raw in data.get("knowledge_list", []):
                item = _media(raw)
                if item["media_type"] == 99:
                    if item["media_id"] in visited:
                        continue
                    visited.append(item["media_id"])
                    folder_names[str(item["media_id"])] = str(item["title"])
                    queue.append({"folder": item["media_id"], "cursor": ""})
                else:
                    total += 1
                    result["copilotTotal"] = total
                    walk.append((copilot_id, item))
            if total > MAX_COPILOT_FILES or len(visited) > MAX_FOLDERS:
                raise ApiError(413, "copilot 知识库内容超过上限，请整理后再更新获取。")
            cursor = next_cursor(data, job["cursor"])
            if cursor is not None:
                job["cursor"] = cursor
                continue
            queue.pop(0)

        downloaded = 0
        for kb_id, item in walk:
            if downloaded >= max_files:
                done = False
                break
            value = await ensure_media(kb_id, item)
            if value is not None:
                downloaded += 1
        result["fetchedThisCall"] = downloaded
        # 目录清单在本次调用内已完整展开，len(walk) 即 copilot 文件总数。
        result["copilotFiles"] = len(walk)
        result["done"] = done

        # 第三段：GEO优化知识库——仅获取列表（知识库列仅作展示）。
        if done and geo_id is not None:
            listed = 0
            cursor = ""
            while True:
                data = await fetch_list(
                    "rules",
                    {"knowledge_base_id": geo_id, "cursor": cursor, "limit": 50},
                    "openapi/wiki/v1/get_knowledge_list",
                    label=f"{GEO_KB_NAME} · 文件清单",
                )
                listed += len(data.get("knowledge_list", []))
                result["geoListed"] = listed
                cursor = next_cursor(data, cursor)
                if cursor is None:
                    break
        return result
    finally:
        if owned_client:
            await http.aclose()
