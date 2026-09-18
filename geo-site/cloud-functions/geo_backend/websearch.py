from __future__ import annotations

import html
import re
from urllib.parse import urlparse

import httpx

from .errors import ApiError

# 联网搜索证据采集（对齐 geo-content-generator §5.0 联网搜索信息采集）：
# 用户问句即检索词，行业背景/趋势/数据/需求场景/FAQ 的证据全部来自真实搜索
# 结果，禁止凭模型内部知识生成。默认通道为搜狗网页结果（免密钥、国内可达、
# 长问句不降级；必应对非浏览器客户端的长查询会退化为首字匹配，不可用）。
# 接入博查/Tavily 等付费信源时在下方增加 provider 即可，批次流程不变。
SEARCH_ENDPOINT = "https://www.sogou.com/web"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

_RESULT = re.compile(r'<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.S)
_CITE = re.compile(r'class="citeLinkClass"[^>]*>(.*?)</a>', re.S)
_SNIPPET = re.compile(r'class="fz-mid[^"]*"[^>]*>(.*?)</div>', re.S)
_TAGS = re.compile(r"<[^>]+>")
_CITE_TAIL = re.compile(r"https?://|\d+\s*(?:小时前|天前|分钟前|分钟前|昨天|前天|今天)")


def _text(value: str) -> str:
    return html.unescape(_TAGS.sub("", value)).strip()


def _site(block: str, url: str) -> str:
    cite = _CITE.search(block)
    if cite:
        name = _CITE_TAIL.split(_text(cite.group(1)))[0].strip()
        if name:
            return name[:40]
    host = urlparse(url).netloc
    return host or ""


def parse_results(page: str, *, limit: int = 8) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    seen: set[str] = set()
    matches = list(_RESULT.finditer(page))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(page)
        block = page[match.end():end]
        title = _text(match.group(2))
        href = html.unescape(match.group(1))
        if not title or not href:
            continue
        url = href if href.startswith("http") else "https://www.sogou.com" + href
        if url in seen:
            continue
        snippet_match = _SNIPPET.search(block)
        snippet = _text(snippet_match.group(1)) if snippet_match else ""
        seen.add(url)
        results.append({
            "title": title,
            "url": url,
            "site": _site(block, url),
            "snippet": snippet[:300],
        })
        if len(results) >= limit:
            break
    return results


async def web_search(query: str, *, client=None, limit: int = 8) -> list[dict[str, str]]:
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(25.0), follow_redirects=True)
    own = client is None
    try:
        response = await http.get(
            SEARCH_ENDPOINT,
            params={"query": query},
            headers={"User-Agent": USER_AGENT, "Accept-Language": "zh-CN,zh;q=0.9"},
        )
        response.raise_for_status()
    except ApiError:
        raise
    except Exception as error:
        raise ApiError(502, "联网搜索服务暂不可用，请稍后重试。") from error
    finally:
        if own:
            await http.aclose()
    results = parse_results(response.text, limit=limit)
    if not results:
        raise ApiError(502, "联网搜索未返回可用结果，请调整问句后重试。")
    return results
