import sys
import unittest
from pathlib import Path

import httpx


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))


SOGOU_PAGE = """<html><body><div class="results">
<div class="vrwrap"><h3 class="vr-title"><a href="https://www.zhihu.com/question/abc" >新<em>能源汽车</em>有什么缺点？ - 知乎</a></h3>
<div class="fz-mid space-txt">电池衰减、保值率低、冬天续航打折是主要缺点。</div>
<a class="citeLinkClass" href="#">知乎  https://www.zhihu.com 2小时前</a></div>
<div class="vrwrap"><h3 class="vr-title"><a href="/link?url=abc123" >新能源汽车的10大劣势 - 今日头条</a></h3>
<div class="fz-mid space-txt">别被忽悠了，买之前先看这10条。</div>
<a class="citeLinkClass" href="#">今日头条  13小时前</a></div>
<div class="vrwrap"><h3 class="vr-title"><a href="/link?url=abc123" >重复链接必须去重</a></h3>
<div class="fz-mid space-txt">重复。</div></div>
<div><h2><a href="https://ad.example.com/not-result">广告位不是自然结果</a></h2></div>
</div></body></html>"""


class WebSearchTests(unittest.IsolatedAsyncioTestCase):
    def test_parse_results_extracts_and_dedupes(self):
        from geo_backend.websearch import parse_results

        results = parse_results(SOGOU_PAGE)
        self.assertEqual(2, len(results))
        self.assertEqual("新能源汽车有什么缺点？ - 知乎", results[0]["title"])
        self.assertEqual("知乎", results[0]["site"])
        self.assertIn("电池衰减", results[0]["snippet"])
        # /link 相对链接必须补全为搜狗绝对地址
        self.assertEqual("https://www.sogou.com/link?url=abc123", results[1]["url"])
        self.assertEqual("今日头条", results[1]["site"])

    async def test_web_search_posts_question_as_query_and_returns_results(self):
        from geo_backend.websearch import web_search

        captured = {}

        def handler(request):
            captured["url"] = str(request.url)
            captured["agent"] = request.headers.get("user-agent", "")
            return httpx.Response(200, text=SOGOU_PAGE)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            results = await web_search("零雪 GEO 代运营怎么样？", client=client)

        self.assertIn("https://www.sogou.com/web", captured["url"])
        self.assertIn("query=", captured["url"])
        self.assertTrue(captured["agent"], "必须携带浏览器 UA")
        self.assertEqual(2, len(results))

    async def test_web_search_empty_page_fails_without_retry(self):
        from geo_backend.errors import ApiError
        from geo_backend.websearch import web_search

        calls = []

        def handler(request):
            calls.append(str(request.url))
            return httpx.Response(200, text="<html><body>无结果页</body></html>")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(ApiError) as raised:
                await web_search("绝无仅有的问句", client=client)
        self.assertEqual(502, raised.exception.status)
        self.assertIn("联网搜索", str(raised.exception))
        self.assertEqual(1, len(calls), "失败不得自动重发")

    async def test_web_search_http_error_maps_to_502(self):
        from geo_backend.errors import ApiError
        from geo_backend.websearch import web_search

        def handler(request):
            return httpx.Response(503, text="busy")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(ApiError) as raised:
                await web_search("任何问句", client=client)
        self.assertEqual(502, raised.exception.status)
        self.assertIn("联网搜索", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
