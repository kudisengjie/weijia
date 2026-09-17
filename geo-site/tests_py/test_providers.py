import sys
import unittest
from pathlib import Path

import httpx


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))


class ProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_qwen_disables_thinking_and_returns_complete_content(self):
        from geo_backend.models import model_selection
        from geo_backend.providers import complete

        captured = {}

        def handler(request):
            captured["request"] = request
            return httpx.Response(
                200,
                request=request,
                json={"model": "qwen3.8-flash", "choices": [{"finish_reason": "stop", "message": {"content": "OK"}}]},
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await complete(model_selection("qwen", "primary"), "secret", [{"role": "user", "content": "test"}], client=client, test=True)

        self.assertEqual("OK", result)
        self.assertIn(b'"enable_thinking":false', captured["request"].content)
        self.assertEqual("Bearer secret", captured["request"].headers["authorization"])

    async def test_zhipu_omits_thinking_switch_because_glm53_rejects_disabled(self):
        from geo_backend.models import model_selection
        from geo_backend.providers import complete

        captured = {}

        def handler(request):
            captured["body"] = request.content
            return httpx.Response(
                200,
                request=request,
                json={"model": "glm-5.3", "choices": [{"finish_reason": "stop", "message": {"content": "OK"}}]},
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await complete(model_selection("zhipu", "secondary"), "secret", [{"role": "user", "content": "test"}], client=client, test=True)

        self.assertNotIn(b'"thinking"', captured["body"])

    async def test_mimo_uses_openai_compatible_bearer_header(self):
        from geo_backend.models import model_selection
        from geo_backend.providers import complete

        captured = {}

        def handler(request):
            captured["headers"] = request.headers
            return httpx.Response(
                200,
                request=request,
                json={"model": "mimo-v2.5", "choices": [{"finish_reason": "stop", "message": {"content": "OK"}}]},
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await complete(model_selection("mimo", "primary"), "mimo-secret", [{"role": "user", "content": "test"}], client=client)

        self.assertEqual("Bearer mimo-secret", captured["headers"]["authorization"])
        self.assertNotIn("api-key", captured["headers"])

    async def test_each_provider_uses_its_official_endpoint(self):
        from geo_backend.models import model_selection
        from geo_backend.providers import complete

        expected = {
            "hunyuan": "https://tokenhub.tencentmaas.com/v1/chat/completions",
            "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            "doubao": "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
            "deepseek": "https://api.deepseek.com/chat/completions",
            "minimax": "https://api.minimax.cn/v1/chat/completions",
            "zhipu": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
            "kimi": "https://api.moonshot.ai/v1/chat/completions",
            "mimo": "https://api.xiaomimimo.com/v1/chat/completions",
        }

        for provider, endpoint in expected.items():
            with self.subTest(provider=provider):
                selected = model_selection(provider, "primary")
                captured = {}

                def handler(request):
                    captured["url"] = str(request.url)
                    return httpx.Response(
                        200,
                        request=request,
                        json={"model": selected["modelId"], "choices": [{"finish_reason": "stop", "message": {"content": "OK"}}]},
                    )

                async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                    await complete(selected, "secret", [{"role": "user", "content": "test"}], client=client, test=True)

                self.assertEqual(endpoint, captured["url"])

    async def test_minimax_kimi_and_mimo_use_completion_token_field(self):
        from geo_backend.models import model_selection
        from geo_backend.providers import complete

        for provider in ("minimax", "kimi", "mimo"):
            with self.subTest(provider=provider):
                selected = model_selection(provider, "primary")
                captured = {}

                def handler(request):
                    captured["body"] = request.content
                    return httpx.Response(
                        200,
                        request=request,
                        json={"model": selected["modelId"], "choices": [{"finish_reason": "stop", "message": {"content": "OK"}}]},
                    )

                async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                    await complete(selected, "secret", [{"role": "user", "content": "test"}], client=client, test=True)

                self.assertIn(b'"max_completion_tokens":128', captured["body"])
                self.assertNotIn(b'"max_tokens"', captured["body"])

    async def test_reasoning_models_allow_full_length_article_output(self):
        from geo_backend.models import model_selection
        from geo_backend.providers import complete

        expected_limits = {"hunyuan": 16384, "minimax": 65536, "kimi": 16384, "mimo": 32768}
        for provider, limit in expected_limits.items():
            with self.subTest(provider=provider):
                selected = model_selection(provider, "primary")
                captured = {}

                def handler(request):
                    captured["body"] = request.content
                    return httpx.Response(
                        200,
                        request=request,
                        json={"model": selected["modelId"], "choices": [{"finish_reason": "stop", "message": {"content": "OK"}}]},
                    )

                async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                    await complete(selected, "secret", [{"role": "user", "content": "test"}], client=client)

                field = b'"max_completion_tokens"' if provider in {"minimax", "kimi", "mimo"} else b'"max_tokens"'
                self.assertIn(field + b':' + str(limit).encode(), captured["body"])

    async def test_returned_model_must_match_the_selected_model(self):
        from geo_backend.errors import ApiError
        from geo_backend.models import model_selection
        from geo_backend.providers import complete

        def handler(request):
            return httpx.Response(
                200,
                request=request,
                json={"model": "other-model", "choices": [{"finish_reason": "stop", "message": {"content": "OK"}}]},
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(ApiError) as rejected:
                await complete(model_selection("deepseek", "primary"), "secret", [], client=client)
        self.assertEqual("MODEL_MISMATCH", rejected.exception.code)

    async def test_kimi_direct_api_uses_the_selected_official_model(self):
        from geo_backend.models import model_selection
        from geo_backend.providers import complete

        def handler(request):
            return httpx.Response(
                200,
                request=request,
                json={"model": "kimi-k2.7-code", "choices": [{"finish_reason": "stop", "message": {"content": "OK"}}]},
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await complete(
                model_selection("kimi", "primary"),
                "secret",
                [{"role": "user", "content": "test"}],
                client=client,
                test=True,
            )

        self.assertEqual("OK", result)

    async def test_protocol_disconnect_is_reported_without_retry(self):
        from geo_backend.errors import ApiError
        from geo_backend.models import model_selection
        from geo_backend.providers import complete

        calls = 0

        def handler(request):
            nonlocal calls
            calls += 1
            raise httpx.RemoteProtocolError("peer disconnected", request=request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(ApiError) as rejected:
                await complete(model_selection("deepseek", "primary"), "secret", [], client=client)

        self.assertEqual("MODEL_TIMEOUT", rejected.exception.code)
        self.assertEqual(1, calls)


if __name__ == "__main__":
    unittest.main()
