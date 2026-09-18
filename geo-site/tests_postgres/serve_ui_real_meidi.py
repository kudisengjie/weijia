"""Real-credential webpage run for 美迪电商教育 (GEO优化问句清单扩容版).

真实 IMA + 真实 DeepSeek + 一次性真实 PostgreSQL + 真实 Edge 浏览器 UI。
与 serve_ui_fixture.py 的区别：不打任何上游桩——IMA 走真实凭据（只允许触碰
白名单知识库 GEO优化知识库 与 copilot），模型走真实 providers.complete。

用法:
  python tests_postgres/serve_ui_real_meidi.py --serve

密钥只从 gitignore 的 .local/verify-keys.json 读取，绝不打印任何值。
浏览器脚本完成后写入 output/playwright/real-meidi/DONE.json，本脚本随即
查询真实数据库（批次、文章工件、积分流水、余额）并输出 REAL_RUN_REPORT。
"""
import json
import os
import sys
import threading
import time
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

DONE_MARKER = ROOT / 'output' / 'playwright' / 'real-meidi' / 'DONE.json'


def verify_database(fixture) -> dict:
    from test_runtime_integration import MASTER
    conn = fixture.conn
    batch = conn.execute(
        'SELECT id, status FROM batches WHERE user_id = %s ORDER BY created_at DESC LIMIT 1',
        (fixture.owner,)).fetchone()
    report = {'batchId': str(batch[0]), 'batchStatus': batch[1]}
    artifact = conn.execute(
        'SELECT id FROM article_artifacts WHERE batch_id = %s', (str(batch[0]),)).fetchone()
    if artifact:
        article = fixture.repo.get_article_artifact(
            fixture.tenant, str(artifact[0]), MASTER, user_id=fixture.owner)
        report.update(
            artifactId=str(artifact[0]), filename=article.get('filename'),
            byteLength=article.get('byteLength'), chars=len(article.get('markdown', '')))
    report['ledgerSum'] = conn.execute(
        'SELECT COALESCE(SUM(amount), 0) FROM credit_ledger WHERE batch_id = %s',
        (str(batch[0]),)).fetchone()[0]
    report['balance'] = fixture.repo.credit_balance(fixture.tenant, fixture.owner)
    return report


def main() -> int:
    keys = json.loads((ROOT / '.local' / 'verify-keys.json').read_text(encoding='utf-8'))
    os.environ['GEO_DEFAULT_BATCH_DELIVERY_MODE'] = 'server_legacy'
    import uvicorn
    from fastapi import FastAPI
    from fastapi.staticfiles import StaticFiles
    from test_runtime_integration import PostgresRuntimeTests, MASTER
    from geo_backend.app import create_app
    from geo_backend.models import SettingsService
    from geo_backend.repository import PostgresRepository

    PostgresRuntimeTests.setUpClass()
    fixture = PostgresRuntimeTests()
    fixture.setUp()
    try:
        fixture.fund(amount=10)
        SettingsService(fixture.repo, MASTER).save_model(
            fixture.owner, 'deepseek', 'primary', '', keys['DEEPSEEK_API_KEY'], False)
        config = replace(
            fixture.config(),
            app_origin='http://127.0.0.1:8769',
            ima_client_id=keys['IMA_OPENAPI_CLIENTID'],
            ima_api_key=keys['IMA_OPENAPI_APIKEY'])

        @contextmanager
        def repository():
            with fixture.connect() as conn:
                yield PostgresRepository(conn, MASTER)

        app = FastAPI()
        # 真实模型与真实 IMA：不传 model_complete 即用生产 providers.complete。
        app.mount('/api', create_app(config, repository))
        app.mount('/', StaticFiles(directory=ROOT / 'dist', html=True))

        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=8769, log_level='warning'))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        deadline = time.monotonic() + 15
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        print(json.dumps(
            {'account': config.geo_account, 'url': 'http://127.0.0.1:8769', 'mode': 'real-credentials'},
            ensure_ascii=False), flush=True)
        try:
            while server.started:
                if DONE_MARKER.exists():
                    report = verify_database(fixture)
                    print('REAL_RUN_REPORT:' + json.dumps(report, ensure_ascii=False), flush=True)
                    break
                time.sleep(1)
        finally:
            server.should_exit = True
            thread.join(timeout=10)
        return 0
    finally:
        fixture.doCleanups()
        PostgresRuntimeTests.tearDownClass()


if __name__ == '__main__':
    raise SystemExit(main())
