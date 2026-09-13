import sys
import unittest
from pathlib import Path

import httpx


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))

from tests_py.fakes import FakeRepository


class ImaTests(unittest.IsolatedAsyncioTestCase):
    async def test_environment_credentials_are_the_default(self):
        from geo_backend.ima import load_ima_credentials

        repository = FakeRepository()
        value = load_ima_credentials(repository, "master", "env-client", "env-key")

        self.assertEqual("env-client", value["clientId"])
        self.assertEqual("env-key", value["apiKey"])

    async def test_admin_update_is_verified_before_atomic_save(self):
        from geo_backend.ima import update_ima_credentials

        repository = FakeRepository()

        def handler(request):
            return httpx.Response(
                200,
                request=request,
                json={"code": 0, "data": {"info_list": [{"name": "copilot", "id": "kb-1"}], "is_end": True}},
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await update_ima_credentials(
                repository,
                "master",
                "a" * 32,
                {"adminSecret": "a" * 32, "clientId": "new-client", "apiKey": "new-key", "expiresAt": "2099-12-01"},
                client=client,
            )

        self.assertTrue(result["saved"])
        self.assertEqual("new-client", repository.ima["clientId"])

    async def test_wrong_admin_secret_does_not_call_ima_or_save(self):
        from geo_backend.errors import ApiError
        from geo_backend.ima import update_ima_credentials

        repository = FakeRepository()
        called = False

        def handler(request):
            nonlocal called
            called = True
            return httpx.Response(500, request=request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(ApiError) as rejected:
                await update_ima_credentials(
                    repository,
                    "master",
                    "a" * 32,
                    {"adminSecret": "wrong", "clientId": "new-client", "apiKey": "new-key", "expiresAt": "2099-12-01"},
                    client=client,
                )
        self.assertEqual("ADMIN_REQUIRED", rejected.exception.code)
        self.assertFalse(called)
        self.assertIsNone(repository.ima)

    async def test_malformed_download_port_is_a_safe_client_error(self):
        from geo_backend.errors import ApiError
        from geo_backend.ima import read_media

        def handler(request):
            self.assertTrue(request.url.path.endswith("/get_media_info"))
            return httpx.Response(
                200,
                request=request,
                json={
                    "code": 0,
                    "data": {
                        "media_type": 1,
                        "url_info": {"url": "https://ima.qq.com:not-a-port/file.pdf", "headers": {}},
                    },
                },
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(ApiError) as rejected:
                await read_media(
                    {"clientId": "client", "apiKey": "key"},
                    {"media_id": "media-1", "title": "file.pdf"},
                    client=client,
                )

        self.assertEqual(422, rejected.exception.status)


if __name__ == "__main__":
    unittest.main()
