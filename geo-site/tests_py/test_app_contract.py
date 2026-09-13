import hashlib
import sys
import unittest
from pathlib import Path

import httpx


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))

from tests_py.fakes import FakeRepository, repository_factory


def configured_settings():
    from geo_backend.config import Settings

    salt = "0123456789abcdef0123456789abcdef"
    value = hashlib.scrypt(b"secret", salt=salt.encode(), n=16384, r=8, p=1, dklen=64).hex()
    return Settings.from_mapping(
        {
            "APP_ORIGIN": "https://geo.example.test",
            "GEO_ACCOUNT": "owner",
            "GEO_PASSWORD_HASH": f"scrypt:{salt}:{value}",
            "GEO_MASTER_KEY": "c" * 64,
            "DATABASE_URL": "postgresql://u:p@db.example.test/geo?sslmode=require",
        }
    )


class AppContractTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import asyncio

        asyncio.get_running_loop().slow_callback_duration = 1.0
        from geo_backend.app import create_app

        self.repository = FakeRepository()
        self.repository.ima = {"clientId": "ima-client", "apiKey": "ima-key", "expiresAt": "2099-01-01", "updatedAt": None}
        self.model_calls = []

        async def model_complete(model, key, messages, **options):
            self.model_calls.append((model, key, messages, options))
            return "OK"

        app = create_app(configured_settings(), repository_factory(self.repository), model_complete=model_complete)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="https://geo.example.test",
        )

    async def asyncTearDown(self):
        await self.client.aclose()

    async def login(self):
        return await self.client.post(
            "/auth/login",
            headers={"Origin": "https://geo.example.test"},
            json={"account": "owner", "password": "secret"},
        )

    async def test_health_is_public_and_never_returns_configuration_values(self):
        response = await self.client.get("/health")

        self.assertEqual(200, response.status_code)
        self.assertEqual({"service": "available", "database": "available", "schemaVersion": 1, "ready": True}, response.json())
        self.assertNotIn("DATABASE_URL", response.text)

    async def test_login_sets_strict_secure_http_only_cookie(self):
        response = await self.login()

        self.assertEqual(200, response.status_code)
        cookie = response.headers["set-cookie"]
        self.assertIn("lxue_session=", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("Secure", cookie)
        self.assertIn("SameSite=strict", cookie)

    async def test_origin_session_csrf_and_logout_contract(self):
        rejected = await self.client.post("/auth/login", json={"account": "owner", "password": "secret"})
        self.assertEqual(403, rejected.status_code)
        self.assertEqual("ORIGIN_REJECTED", rejected.json()["code"])

        login = await self.login()
        csrf = login.json()["csrf"]
        session = await self.client.get("/auth/session")
        self.assertEqual(200, session.status_code)
        self.assertTrue(session.json()["authenticated"])
        refreshed_csrf = session.json()["csrf"]
        self.assertEqual(csrf, refreshed_csrf)

        bad_logout = await self.client.post(
            "/auth/logout", headers={"Origin": "https://geo.example.test", "X-CSRF-Token": "wrong"}, json={}
        )
        self.assertEqual(403, bad_logout.status_code)

        logout = await self.client.post(
            "/auth/logout", headers={"Origin": "https://geo.example.test", "X-CSRF-Token": refreshed_csrf}, json={}
        )
        self.assertEqual(200, logout.status_code)
        self.assertIn("Max-Age=0", logout.headers["set-cookie"])
        self.assertEqual(401, (await self.client.get("/auth/session")).status_code)

    async def test_oversized_login_body_is_rejected_before_validation(self):
        response = await self.client.post(
            "/auth/login",
            headers={"Origin": "https://geo.example.test", "Content-Type": "application/json"},
            content=b'{"account":"' + (b"a" * 5000) + b'","password":"secret"}',
        )

        self.assertEqual(413, response.status_code)
        self.assertEqual("REQUEST_TOO_LARGE", response.json()["code"])

    async def test_model_settings_persist_and_real_test_uses_saved_key(self):
        login = await self.login()
        csrf = login.json()["csrf"]
        headers = {"Origin": "https://geo.example.test", "X-CSRF-Token": csrf}

        initial = await self.client.get("/settings")
        self.assertEqual("deepseek", initial.json()["model"]["id"])
        saved = await self.client.post(
            "/settings/model",
            headers=headers,
            json={"provider": "qwen", "slot": "secondary", "modelId": "", "apiKey": "provider-secret"},
        )
        self.assertEqual(200, saved.status_code)
        current = (await self.client.get("/settings")).json()
        self.assertEqual("qwen", current["model"]["id"])
        self.assertTrue(current["providers"]["qwen"]["configured"])
        self.assertNotIn("provider-secret", repr(current))

        tested = await self.client.post("/models/test", headers=headers, json={})
        self.assertEqual(200, tested.status_code)
        self.assertEqual(1, len(self.model_calls))
        self.assertEqual("provider-secret", self.model_calls[0][1])

    async def test_batch_create_list_and_detail_preserve_frontend_contract(self):
        login = await self.login()
        csrf = login.json()["csrf"]
        headers = {"Origin": "https://geo.example.test", "X-CSRF-Token": csrf}
        await self.client.post(
            "/settings/model",
            headers=headers,
            json={"provider": "qwen", "slot": "primary", "modelId": "", "apiKey": "provider-secret"},
        )

        created = await self.client.post(
            "/batches",
            headers=headers,
            json={
                "requestId": "request-id-123456",
                "rows": [["品牌名", "GEO知识库", "问句"], ["零雪", "品牌库", "零雪是什么？"]],
                "companies": [{"name": "company.md", "brand": "零雪", "text": "公司正文"}],
            },
        )
        self.assertEqual(200, created.status_code)
        batch_id = created.json()["id"]
        listed = (await self.client.get("/batches")).json()["batches"]
        detail = (await self.client.get(f"/batches/{batch_id}")).json()

        self.assertEqual(batch_id, listed[0]["id"])
        self.assertEqual([], detail["articles"])
        self.assertEqual("定位知识库", detail["phaseLabel"])

        locked = await self.client.post(
            "/settings/model",
            headers=headers,
            json={"provider": "deepseek", "slot": "primary", "modelId": "", "apiKey": "another-key"},
        )
        self.assertEqual(409, locked.status_code)
        self.assertEqual("MODEL_LOCKED_DURING_BATCH", locked.json()["code"])


if __name__ == "__main__":
    unittest.main()
