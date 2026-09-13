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

    async def test_mimo_uses_api_key_header(self):
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

        self.assertEqual("mimo-secret", captured["headers"]["api-key"])
        self.assertNotIn("authorization", captured["headers"])

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
