"""Loopback-only UI fixture: disposable real PostgreSQL, deterministic paid APIs."""
import asyncio
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import os
import subprocess
import threading
import time

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_runtime_integration import PostgresRuntimeTests, MASTER
from geo_backend.app import create_app
from geo_backend.repository import PostgresRepository
from geo_backend.security import hash_password


def main():
    PostgresRuntimeTests.setUpClass()
    fixture = PostgresRuntimeTests()
    fixture.setUp()
    batch = fixture.prepared_batch(1)
    now = datetime.now(timezone.utc)
    member = fixture.repo.create_member(tenant_id=fixture.tenant, username='qa-member',
        password_hash=hash_password('test-password'), role='member', starts_at=now, expires_at=now + timedelta(days=30))
    config = fixture.config()
    if '--resume' in sys.argv:
        fixture.fund(member['id'], 5)

    @contextmanager
    def repository():
        with fixture.connect() as conn:
            yield PostgresRepository(conn, MASTER)

    async def model(_model, _key, messages, **_kwargs):
        await asyncio.sleep(2)
        payload = json.loads(messages[-1]['content'])
        return '{"passed":true,"issues":[]}' if 'draft' in payload else '# UI 联调文章\n这是本机固定测试响应，不是真实模型生成。'

    @asynccontextmanager
    async def lifespan(_app):
        try:
            yield
        finally:
            fixture.doCleanups()
            PostgresRuntimeTests.tearDownClass()

    from dataclasses import replace
    app = FastAPI(lifespan=lifespan)
    app.mount('/api', create_app(replace(config, app_origin='http://127.0.0.1:8769'), repository, model_complete=model))
    app.mount('/', StaticFiles(directory=Path(__file__).resolve().parents[1] / 'dist', html=True))
    print(json.dumps({'fixtureAccount': config.geo_account, 'batchId': batch['id'], 'url': 'http://127.0.0.1:8769'}, ensure_ascii=False), flush=True)
    if '--browser' in sys.argv:
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=8769, log_level='warning'))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        try:
            command = ['node', str(Path(__file__).with_name('browser_ui_smoke.mjs')), config.geo_account]
            if '--resume' in sys.argv: command.append('--resume')
            if '--layout-only' in sys.argv: command.append('--layout-only')
            result = subprocess.run(command, check=False, env=os.environ, timeout=150)
        finally:
            server.should_exit = True
            thread.join(timeout=10)
        return result.returncode
    uvicorn.run(app, host='127.0.0.1', port=8769, log_level='warning')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
