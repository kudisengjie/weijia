"""问句存储 CRUD + 已结束批次删除 + 失败任务补跑（吕老师 2026-09-19）。"""
import asyncio
import json
from pathlib import Path
import sys
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_runtime_integration as fixtures
MASTER = fixtures.MASTER
from geo_backend.batches import BatchService
from geo_backend.errors import ApiError
from geo_backend.questions import QuestionService
from geo_backend.workspaces import WorkspaceService

QUESTIONS_JSON = json.dumps([
    {'question': f'广州宠物寄养怎么选？第{i}条', 'intent': '交易型', 'stage': '筛选对比', 'score': 90 - i, 'reason': '商业价值高'}
    for i in range(1, 6)], ensure_ascii=False)


class QuestionReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixtures.PostgresRuntimeTests.setUpClass()

    @classmethod
    def tearDownClass(cls):
        fixtures.PostgresRuntimeTests.tearDownClass()

    def setUp(self):
        self.fx = fixtures.PostgresRuntimeTests()
        self.fx.setUp()
        self.addCleanup(self.fx.doCleanups)
        self.owner, self.repo = self.fx.owner, self.fx.repo

    def discover_once(self, notes=''):
        """跑一次带 mock 的问句查询，返回归档后的记录列表。"""
        import httpx
        def handler(request):
            if request.url.host == 'www.sogou.com':
                return httpx.Response(200, text=self.fx.sogou_page(fixtures.WEB_RESULTS))
            raise AssertionError('Unexpected host ' + request.url.host)
        async def model(model_name, key, messages, **kwargs):
            # analyze 调用返回行业判断 JSON；generate 调用（含搜索线索）返回问句数组。
            if '搜索线索' not in messages[-1]['content']:
                return '{"industry":"宠物服务","business":"宠物寄养与洗护","products":["宠物寄养"],"audience":"城市养宠家庭"}'
            return QUESTIONS_JSON
        async def run():
            self.fx.fund(amount=1)
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                service = QuestionService(self.repo, MASTER, client=client, model_complete=model)
                result = await service.discover(
                    [{'name': '公司介绍.docx', 'text': '我们提供宠物寄养与洗护服务。'}], 5,
                    self.owner, self.fx.tenant, notes=notes)
                self.assertEqual(5, len(result['questions']))
                # 与 app.py /questions/discover 行为一致：查询成功即归档。
                service.store_report(self.owner, self.fx.tenant, result, notes=notes)
        asyncio.run(run())
        return self.repo.list_question_reports(self.owner)

    def test_discover_auto_archives_report_with_notes(self):
        # 查询成功后结果自动进入问句存储；备注一并归档，前端可还原保存。
        reports = self.discover_once(notes='面向广州本地客户，突出寄养安全')
        self.assertEqual(1, len(reports))
        self.assertEqual(5, reports[0]['questionCount'])
        self.assertIn('宠物服务', reports[0]['title'])
        detail = self.repo.get_question_report(self.owner, reports[0]['id'])
        self.assertEqual(5, len(detail['payload']['questions']))
        self.assertEqual('面向广州本地客户，突出寄养安全', detail['payload']['notes'])
        self.assertIn('问句查询报告', detail['payload']['markdown'])

    def test_reports_encrypted_at_rest_and_isolated_per_user(self):
        reports = self.discover_once()
        report = reports[0]
        raw = self.fx.conn.execute(
            'SELECT payload_cipher FROM question_reports WHERE id = %s', (report['id'],)).fetchone()[0]
        self.assertNotIn('宠物寄养'.encode(), bytes(raw), '问句负载必须密文落库')
        # 其他账号读取/删除一律 404。
        other = self.repo.upsert_configured_user('other-' + uuid.uuid4().hex, 'unused-test-hash')['id']
        with self.assertRaises(ApiError) as denied:
            QuestionService(self.repo, MASTER).get_report(other, report['id'])
        self.assertEqual(404, denied.exception.status)
        with self.assertRaises(ApiError):
            QuestionService(self.repo, MASTER).delete_report(other, report['id'])
        # 本人可删除。
        QuestionService(self.repo, MASTER).delete_report(self.owner, report['id'])
        self.assertEqual([], self.repo.list_question_reports(self.owner))

    def test_archive_allows_failed_batch_but_blocks_running(self):
        # 已失败/已结束的批次可以删除记录；运行中的批次仍不可删。
        self.fx.fund(amount=2)
        workspace_service = WorkspaceService(self.repo, MASTER, self.fx.context, None)
        w = workspace_service.create(str(uuid.uuid4()), self.owner)
        batch_service = BatchService(self.repo, MASTER, {'clientId': 'test-client', 'apiKey': 'test-ima'}, tenant_context=self.fx.context)
        service = WorkspaceService(self.repo, MASTER, self.fx.context, batch_service)
        body = self.fx.body(1)
        w = service.save(w['id'], self.owner, w['version'], {'title': '删除测试', 'taskFileName': '任务.xlsx', 'sheetName': '任务',
                    'rows': body['rows'], 'companies': body['companies'],
                    'model': {'id': 'qwen', 'slot': 'primary', 'modelId': ''}})
        started = service.start(w['id'], self.owner, w['version'], self.fx.context['expiresAt'])
        # 任务运行中：删除被拒绝。
        with self.assertRaises(ApiError) as running:
            service.archive(w['id'], self.owner, started['version'])
        self.assertEqual('WORKSPACE_LOCKED', running.exception.code)
        # 人为把批次状态置为 failed（模拟真实失败批次），删除应放行。
        self.fx.conn.execute(
            "UPDATE batches SET state_cipher = pgp_sym_encrypt("
            "jsonb_set(pgp_sym_decrypt(state_cipher, %s)::jsonb, '{state,status}', '\"failed\"')::text, %s) WHERE id = %s",
            (MASTER, MASTER, started['batch']['id']))
        fresh = service.get(w['id'], self.owner)
        archived = service.archive(w['id'], self.owner, fresh['version'])
        self.assertEqual('archived', archived['status'])

    def test_retry_failed_rebuilds_only_failed_tasks(self):
        # 失败任务可补跑：用原任务行重建新批次，不重发结果不明的模型请求。
        self.fx.fund(amount=3)
        bases = [{'id': 'KB-Copilot', 'name': 'copilot'}]
        handler = self.fx.ima_rules_handler(bases=bases, web_results=[])
        async def model(model_name, key, messages, **kwargs):
            self.fail('无搜索证据时不得调用模型')
        result = self.fx.run_batch_to_completion(self.fx.body(2), handler, model)
        self.assertEqual('completed', result['status'], result)
        self.assertEqual(2, len(result['failedTasks']), result)
        self.assertEqual(3, self.repo.credit_balance(self.fx.tenant, self.owner), '失败任务必须全额退积分')
        batch_service = BatchService(self.repo, MASTER, {'clientId': 'test-client', 'apiKey': 'test-ima'}, tenant_context=self.fx.context)
        retry = batch_service.retry_failed(result['id'], self.owner, self.fx.context['expiresAt'])
        self.assertIsNot(retry['id'], result['id'])
        self.assertEqual(2, retry['total'])
        self.assertEqual(1, self.repo.credit_balance(self.fx.tenant, self.owner), '补跑批次重新预扣 2 积分')
        # 同一来源批次重复补跑命中幂等：返回同一个补跑批次。
        again = batch_service.retry_failed(result['id'], self.owner, self.fx.context['expiresAt'])
        self.assertEqual(retry['id'], again['id'])
        # 没有失败任务的批次（补跑批次未运行，状态 ready）不允许补跑。
        with self.assertRaises(ApiError) as empty:
            batch_service.retry_failed(retry['id'], self.owner, self.fx.context['expiresAt'])
        self.assertEqual(409, empty.exception.status)


if __name__ == '__main__':
    unittest.main()
