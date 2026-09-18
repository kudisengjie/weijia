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
    workspace_mode = '--workspaces' in sys.argv
    local_delivery_mode = '--local-delivery' in sys.argv
    # Pause/resume, cancel-refund and awaiting-save lifecycles are mode-specific;
    # every browser script pins the delivery mode it was written against.
    os.environ['GEO_DEFAULT_BATCH_DELIVERY_MODE'] = (
        'local_confirmed_v1' if local_delivery_mode else 'server_legacy')
    batch = None if (workspace_mode or local_delivery_mode) else fixture.prepared_batch(1, legacy=True)
    if workspace_mode or local_delivery_mode:
        from geo_backend.models import SettingsService
        fixture.fund(amount=10)
        SettingsService(fixture.repo, MASTER).save_model(fixture.owner, 'deepseek', 'primary', '', 'test-second-key', False)
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
        await asyncio.sleep(8 if workspace_mode else 2)
        payload = json.loads(messages[-1]['content'])
        if workspace_mode:
            from geo_backend.errors import ApiError
            question = payload['task']['question']
            if question == '问题5':
                raise ApiError(502, '测试供应商拒绝第五工作区')
            return '{"passed":true,"issues":[]}' if 'draft' in payload else f'# {question}\n这是本机固定测试响应，不是真实模型生成。'
        if local_delivery_mode:
            from geo_backend.errors import ApiError
            question = payload['task']['question']
            if question in ('问题4', '问题5'):
                raise ApiError(502, '测试供应商拒绝第四/第五工作区')
            return '{"passed":true,"issues":[]}' if 'draft' in payload else f'# {question}\n这是本机固定测试响应，不是真实模型生成。'
        return '{"passed":true,"issues":[]}' if 'draft' in payload else '# UI 联调文章\n这是本机固定测试响应，不是真实模型生成。'

    # Stub only IMA upstream transport. Real cache/locks, rules, task state and billing execute.
    if workspace_mode or local_delivery_mode:
        from unittest.mock import patch
        async def ima(_credentials, path, payload, **_kwargs):
            kind = path.rsplit('/', 1)[-1]
            if kind == 'search_knowledge_base':
                return {'info_list': [{'id': 'KB-Copilot', 'name': 'copilot'}, {'id': 'KB-Brand', 'name': 'GEO优化知识库'}], 'is_end': True}
            if kind == 'get_knowledge_list':
                files = {'': [{'folder_id': 'gen', 'name': 'geo-content-generator'}, {'folder_id': 'audit', 'name': 'geo-audit'}, {'media_id': 'memory', 'title': '零雪AI_记忆库完整档案.md'}],
                         'gen': [{'media_id': 'rules', 'title': '生成规则.md'}], 'audit': [{'media_id': 'audit-rules', 'title': '审核规则.md'}]}
                return {'knowledge_list': files[payload.get('folder_id', '')], 'is_end': True}
            if kind == 'search_knowledge':
                return {'info_list': [{'media_id': 'evidence', 'title': '品牌证据.md'}], 'is_end': True}
            if kind == 'get_media_info':
                return {'media_type': 11, 'notebook_ext_info': {'notebook_id': payload['media_id']}}
            if kind == 'get_doc_content':
                return {'content': '零雪内容服务；仅使用提供的事实生成完整文章。'}
            raise AssertionError('Unexpected IMA endpoint: ' + kind)
        upstream = patch('geo_backend.ima.ima_post', ima)
        upstream.start()
        fixture.addCleanup(upstream.stop)
        batch_upstream = patch('geo_backend.batches.ima_post', ima)
        batch_upstream.start()
        fixture.addCleanup(batch_upstream.stop)

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
    print(json.dumps({'fixtureAccount': config.geo_account, 'batchId': batch['id'] if batch else None, 'url': 'http://127.0.0.1:8769'}, ensure_ascii=False), flush=True)
    if '--browser' in sys.argv:
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=8769, log_level='warning'))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        try:
            script = ('browser_local_delivery.mjs' if local_delivery_mode
                      else 'browser_workspace_boundaries.mjs' if '--boundaries' in sys.argv
                      else 'browser_workspaces.mjs' if workspace_mode else 'browser_ui_smoke.mjs')
            command = ['node', str(Path(__file__).with_name(script)), config.geo_account]
            if '--resume' in sys.argv: command.append('--resume')
            if '--layout-only' in sys.argv: command.append('--layout-only')
            if os.environ.get('GEO_E2E_EXTERNAL_NODE'):
                # The caller runs the script against this live server themselves
                # (some sandboxes stall node trees spawned from python).
                print(json.dumps({'externalNode': True, 'script': script}), flush=True)
                result = None
            else:
                result = subprocess.run(command, check=False, env=os.environ, timeout=150)
        finally:
            server.should_exit = True
            thread.join(timeout=10)
        return result.returncode if result is not None else 0
    uvicorn.run(app, host='127.0.0.1', port=8769, log_level='warning')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
