"""问句查询真实链路验证（吕老师 2026-09-18 指令：真实测试通过后才允许推送）。

真实组件：真实隔离 PostgreSQL（55483）+ 真实 DeepSeek API（.local/verify-keys.json）
+ 真实搜狗联网搜索 + 真实 FastAPI 路由/会话/CSRF + 真实积分预扣与返还。
不涉及 IMA（生成内容链路的真实测试待 IMA 每日配额恢复后进行）。
不打印任何密钥值。
"""
import asyncio
import json
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'cloud-functions'))
sys.path.insert(0, str(ROOT / 'tests_postgres'))

from test_runtime_integration import PostgresRuntimeTests, MASTER, hash_password  # noqa: E402
from geo_backend.app import create_app  # noqa: E402
from geo_backend.models import SettingsService  # noqa: E402
from geo_backend.repository import PostgresRepository  # noqa: E402

COMPANY_TEXT = (
    '广州美迪信息科技有限公司专注电商代运营服务，为品牌商家提供天猫、京东、抖音、小红书等平台的'
    '整店代运营、直播代运营、短视频内容制作、达人投放与数据复盘服务。公司深耕美妆、个护、食品类目，'
    '提供按效果付费的合作模式，服务过多个天猫头部品牌，团队约200人，在广州、杭州设有运营中心。'
)


async def main() -> int:
    keys = json.loads((ROOT / '.local' / 'verify-keys.json').read_text(encoding='utf-8'))
    PostgresRuntimeTests.setUpClass()
    fixture = PostgresRuntimeTests()
    fixture.setUp()
    failures = []
    try:
        fixture.fund(amount=5)
        SettingsService(fixture.repo, MASTER).save_model(
            fixture.owner, 'deepseek', 'primary', '', keys['DEEPSEEK_API_KEY'], False)
        config = fixture.config()

        @contextmanager
        def repository():
            with fixture.connect() as conn:
                yield PostgresRepository(conn, MASTER)

        app = create_app(config, repository)
        balance_before = fixture.repo.credit_balance(fixture.tenant, fixture.owner)
        print(f'[0/4] 初始积分：{balance_before}')

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost',
                                     headers={'origin': 'http://localhost'}, timeout=180) as client:
            print('[1/4] 真实登录（会话+CSRF）…')
            login = await client.post('/auth/login', json={'account': config.geo_account, 'password': 'test-password'})
            if login.status_code != 200:
                failures.append(f'登录失败 {login.status_code}')
                raise RuntimeError(failures)
            client.headers['x-csrf-token'] = login.json()['csrf']
            print('  登录 OK')

            print('[2/4] 参数越界保护（count=4，不应扣分）…')
            bad = await client.post('/questions/discover', json={'docs': [{'name': '公司介绍.docx', 'text': COMPANY_TEXT}], 'count': 4})
            print(f'  返回 {bad.status_code} {bad.json().get("code", "")}')
            if bad.status_code != 400 or bad.json().get('code') != 'INVALID_QUESTION_COUNT':
                failures.append('count=4 未被 400 拒绝')
            if fixture.repo.credit_balance(fixture.tenant, fixture.owner) != balance_before:
                failures.append('参数越界竟扣了积分')

            print('[3/4] 真实问句查询（真实 DeepSeek 判行业 + 真实搜狗 4 路搜索 + 真实模型排序）…')
            response = await client.post('/questions/discover', json={
                'docs': [{'name': '公司介绍.docx', 'text': COMPANY_TEXT}], 'count': 8})
            if response.status_code != 200:
                failures.append(f'查询失败 {response.status_code}: {response.text[:200]}')
                raise RuntimeError(failures)
            data = response.json()
            questions = data['questions']
            analysis = data['analysis']
            print(f"  行业判断：{analysis['industry']}｜产品：{'、'.join(analysis.get('products') or [])}")
            for index, item in enumerate(questions, start=1):
                print(f"  {index}. {item['question']}（{item['intent']} · {item['stage']} · {item['score']}）")

            print('[4/4] 校验问句质量与扣分链路…')
            balance_after = fixture.repo.credit_balance(fixture.tenant, fixture.owner)
            recommend_count = sum(1 for item in questions if '推荐' in item['question'])
            checks = {
                '产出数量正确（8 条）': len(questions) == 8,
                '行业判断非空': bool(analysis['industry']),
                '全部预扣 1 积分（5→4）': balance_after == balance_before - 1,
                '问句长度合理（6-60 字）': all(6 <= len(item['question']) <= 60 for item in questions),
                '意图标签合法': all(item['intent'] in {'信息型', '调研型', '对比型', '交易型', '导航型'} for item in questions),
                '决策阶段合法': all(item['stage'] in {'初步了解', '筛选对比', '最终下单'} for item in questions),
                '评分在 0-100': all(0 <= item['score'] <= 100 for item in questions),
                '推荐型为主（≥半数交易/对比/调研意图）': sum(1 for item in questions if item['intent'] in {'交易型', '对比型', '调研型'}) >= len(questions) / 2,
                '未每条重复「推荐」二字': recommend_count < len(questions),
                '报告 MD 生成': data['markdown'].startswith('问句查询报告'),
                '无编造 http 链接': all('http' not in item['question'].lower() for item in questions),
            }
            for name, ok in checks.items():
                print(f'   {"PASS" if ok else "FAIL"} - {name}')
                if not ok:
                    failures.append(name)

            print('[附加] 无积分账号拒绝（402 INSUFFICIENT_CREDITS）…')
            member = fixture.repo.create_member(tenant_id=fixture.tenant, username='q-' + fixture.owner[:8],
                password_hash=hash_password('member-password'), role='member',
                starts_at=datetime.now(timezone.utc), expires_at=datetime.now(timezone.utc))
            # 直接用服务层验证余额不足路径（不给 member 充值）
            from geo_backend.errors import ApiError
            from geo_backend.questions import QuestionService
            service = QuestionService(fixture.repo, MASTER)
            try:
                await service.discover([{'name': 'a', 'text': COMPANY_TEXT}], 5, member['id'], fixture.tenant)
                failures.append('零积分账号未被拒绝')
            except ApiError as error:
                ok = error.code == 'INSUFFICIENT_CREDITS'
                print(f'   {"PASS" if ok else "FAIL"} - 零积分拒绝（{error.code}）')
                if not ok:
                    failures.append('零积分拒绝码不正确')

            ledger = fixture.repo.list_credit_ledger(fixture.tenant, fixture.owner)
            kinds = [(row['kind'], row['amount']) for row in ledger][:3]
            print(f'  积分流水（最近3条）：{kinds}')
            if not any(kind == 'reserve' and amount == -1 for kind, amount in kinds):
                failures.append('流水中缺少 reserve -1 记录')
    finally:
        fixture.doCleanups()
        PostgresRuntimeTests.tearDownClass()

    report = {'failures': failures, 'ok': not failures}
    print('REAL_QUESTION_REPORT:' + json.dumps(report, ensure_ascii=False))
    return 0 if not failures else 1


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
