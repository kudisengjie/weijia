"""视觉验证专用 UI 服务：真实隔离 PG + 真实 EdgeOne 前端，纯本地（不调付费 API）。
启动后等待 DONE_MARKER 文件出现即退出；供 Playwright 视觉检查脚本使用。"""
import json
import os
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tests_postgres'))
sys.path.insert(0, str(ROOT / 'cloud-functions'))

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from test_runtime_integration import PostgresRuntimeTests, MASTER
from geo_backend.app import create_app
from geo_backend.repository import PostgresRepository

from dataclasses import replace


def main():
    PostgresRuntimeTests.setUpClass()
    fixture = PostgresRuntimeTests()
    fixture.setUp()
    try:
        config = replace(fixture.config(), app_origin='http://127.0.0.1:8769')

        from contextlib import contextmanager
        @contextmanager
        def repository():
            with fixture.connect() as conn:
                yield PostgresRepository(conn, MASTER)

        app = FastAPI()
        app.mount('/api', create_app(config, repository))
        app.mount('/', StaticFiles(directory=ROOT / 'dist', html=True))

        done_marker = ROOT / 'tests_postgres' / 'output' / 'visual_done.marker'
        if done_marker.exists():
            done_marker.unlink()
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=8769, log_level='warning'))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        deadline = time.monotonic() + 15
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        print(json.dumps({'account': config.geo_account, 'url': 'http://127.0.0.1:8769'}), flush=True)
        try:
            while server.started and not done_marker.exists():
                time.sleep(0.5)
        finally:
            server.should_exit = True
            thread.join(timeout=10)
        return 0
    finally:
        fixture.doCleanups()
        PostgresRuntimeTests.tearDownClass()


if __name__ == '__main__':
    raise SystemExit(main())
