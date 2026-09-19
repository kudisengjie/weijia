"""吕老师 2026-09-19 指令：真实跑三遍完整生成流程，弄清楚具体出现什么问题。

三遍配置与线上失败批次一致：DeepSeek×1 + 智谱 GLM-5.3 Flash×2（美迪电商教育）。
每遍走真实 providers.complete（不 mock 模型），逐步打印阶段、耗时与错误；
目标：定位「模型连接中断/超时」到底发生在哪个阶段、耗时多少。

密钥从 .local/verify-keys.json 读取（gitignored，用后即删）：
  {"DEEPSEEK_API_KEY": "sk-...", "ZHIPU_API_KEY": "....", "IMA_OPENAPI_CLIENTID": "(可选)", "IMA_OPENAPI_APIKEY": "(可选)"}

用法：.venv/Scripts/python.exe tests_postgres/verify_real_runs.py
"""
import asyncio
import json
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

KEYS = ROOT / '.local' / 'verify-keys.json'
OUT = ROOT / 'output' / 'real-runs'
BRAND = '美迪电商教育'
QUESTION = '学习淘宝运营哪家培训机构值得选择'
TEXT = (
    '美迪电商教育深耕电商培训领域，提供淘宝运营、拼多多运营、抖音电商等系统化课程。'
    '师资为一线实战讲师，课程覆盖从入门到高阶运营的全周期，学员遍布全国。'
    '公司位于广州，提供线上直播与线下面授两种学习方式，并配套就业指导服务。'
)
# 三个独立信源：模拟真实联网搜索的最少合规证据集（与 verify_meidi 相同口径）。
WEB_SOURCES = [
    {'title': '2026年中国电商代运营行业发展趋势观察', 'url': 'https://www.sohu.com/insight/26daiguo',
     'site': 'sohu.com', 'snippet': '电商代运营行业保持稳定增长，企业愈发重视人才体系化培养。'},
    {'title': '电商人才缺口与培训市场调研', 'url': 'https://www.163.com/edu/2026rcgap',
     'site': '163.com', 'snippet': '电商运营岗位人才缺口持续，系统化培训机构成为学习者主要选择。'},
    {'title': '淘宝运营学习者选机构关注因素分析', 'url': 'https://www.zhihu.com/market/2026xuanjigou',
     'site': 'zhihu.com', 'snippet': '学习者选机构时最关注实战课程、师资与就业支持。'},
]
RUNS = [('deepseek', 'primary'), ('zhipu', 'primary'), ('zhipu', 'secondary')]


def timed_advance(service, fixture, result, owner):
    """推进到终态，逐步打印阶段与耗时；返回 (result, step_logs)。"""
    logs = []
    for step in range(30):
        if result['status'] != 'ready':
            break
        began = time.perf_counter()
        result = asyncio.run(service.advance(result['id'], {'seq': result['seq']}, owner))
        seconds = time.perf_counter() - began
        line = (f"  step {step}: phase={result['phase']} status={result['status']} "
                f"completed={result['completed']} requests={result['requests']} 耗时 {seconds:.1f}s")
        if result.get('error'):
            line += f" error={result['error']}"
        print(line, flush=True)
        logs.append({'step': step, 'phase': result['phase'], 'seconds': round(seconds, 1),
                     'status': result['status'], 'error': result.get('error') or ''})
    return result, logs


def run_once(fixture, provider, slot, keys, master, label):
    print(f"\n===== 第 {label} 遍：{provider}（{slot}）=====", flush=True)
    from geo_backend.models import SettingsService
    from geo_backend.batches import BatchService
    from geo_backend.providers import complete as real_complete
    api_key = keys['DEEPSEEK_API_KEY' if provider == 'deepseek' else 'ZHIPU_API_KEY']
    SettingsService(fixture.repo, master).save_model(fixture.owner, provider, slot, '', api_key, False)
    real_service = BatchService(
        fixture.repo, master,
        # IMA 凭据只需通过 _materialize 的非空校验；本验证注入规则后直接进 generate 阶段，不会真实调用 IMA。
        {'clientId': keys.get('IMA_OPENAPI_CLIENTID') or 'verify-placeholder',
         'apiKey': keys.get('IMA_OPENAPI_APIKEY') or 'verify-placeholder'},
        tenant_context=fixture.context, model_complete=real_complete)
    body = {'requestId': str(uuid.uuid4()),
            'rows': [['品牌名', 'GEO知识库', '问句'], [BRAND, '品牌库', QUESTION]],
            'companies': [{'name': '美迪公司介绍.md', 'brand': BRAND, 'text': TEXT}]}
    result = real_service.create(body, fixture.owner, datetime.now(timezone.utc) + timedelta(days=30))
    fixture.conn.execute("UPDATE batches SET delivery_mode = 'server_legacy' WHERE id = %s", (result['id'],))
    batch = fixture.repo.get_batch(fixture.owner, result['id'])
    # 跳过 IMA 抓取（本验证聚焦模型生成/审核链路，不依赖真实 IMA 凭据）：
    # 直接置为 generate 阶段并注入规则与联网证据。
    batch.update(phase='generate',
                 rules={'generation': ['围绕问句与公司事实写一篇完整 GEO 文章，标题即问句，正文 1200 字以上；公司事实只使用公司资料，行业背景引用 webEvidence 来源；结尾自然引导了解美迪电商教育。'],
                        'audit': ['核对文章中的公司事实均来自公司资料、行业事实均来自 webEvidence，无编造数据，无夸大宣传。'],
                        'memory': [BRAND]},
                 webSources=WEB_SOURCES, webCache={QUESTION: WEB_SOURCES})
    assert fixture.repo.save_batch(fixture.owner, result['id'], batch, batch['seq'])
    began = time.perf_counter()
    result, logs = timed_advance(real_service, fixture, result, fixture.owner)
    total = time.perf_counter() - began
    slowest = max(logs, key=lambda item: item['seconds']) if logs else {}
    summary = {'run': label, 'provider': provider, 'slot': slot, 'status': result['status'],
               'completed': result['completed'], 'total': result['total'],
               'error': result.get('error') or '', 'totalSeconds': round(total, 1),
               'slowestStep': slowest, 'steps': logs,
               'failedTasks': result.get('failedTasks', [])}
    print('  =>', json.dumps({k: summary[k] for k in ('status', 'completed', 'total', 'error', 'totalSeconds')}, ensure_ascii=False), flush=True)
    if result['status'] == 'completed' and result['completed']:
        row = fixture.conn.execute('SELECT id FROM article_artifacts WHERE batch_id = %s', (result['id'],)).fetchone()
        if row:
            from geo_backend.repository import PostgresRepository
            article = fixture.repo.get_article_artifact(fixture.tenant, str(row[0]), master, user_id=fixture.owner)
            OUT.mkdir(parents=True, exist_ok=True)
            target = OUT / f"run{label}-{provider}.md"
            Path(target).write_text(article['markdown'], encoding='utf-8')
            summary['article'] = str(target)
            print('  ARTICLE_SAVED:', target, f"({article['byteLength']} bytes)", flush=True)
    return summary


def main():
    if not KEYS.exists():
        raise SystemExit(
            '缺少 .local/verify-keys.json（用后即删）。请写入：\n'
            '{"DEEPSEEK_API_KEY": "sk-...", "ZHIPU_API_KEY": "..."}\n'
            '然后重跑：.venv/Scripts/python.exe tests_postgres/verify_real_runs.py')
    keys = json.loads(KEYS.read_text(encoding='utf-8'))
    from test_runtime_integration import PostgresRuntimeTests, MASTER
    PostgresRuntimeTests.setUpClass()
    fixture = PostgresRuntimeTests()
    fixture.setUp()
    summaries = []
    try:
        fixture.fund(amount=10)
        for index, (provider, slot) in enumerate(RUNS, 1):
            summaries.append(run_once(fixture, provider, slot, keys, MASTER, index))
    finally:
        fixture.doCleanups()
        PostgresRuntimeTests.tearDownClass()
        try:
            KEYS.unlink()
            print('\nverify-keys.json deleted after use')
        except FileNotFoundError:
            pass
    OUT.mkdir(parents=True, exist_ok=True)
    report = OUT / 'real-runs-report.json'
    report.write_text(json.dumps(summaries, ensure_ascii=False, indent=2), encoding='utf-8')
    print('\n===== 三遍汇总 =====')
    for item in summaries:
        slow = item.get('slowestStep') or {}
        print(f"第 {item['run']} 遍 {item['provider']}: {item['status']} "
              f"completed={item['completed']}/{item['total']} 总耗时 {item['totalSeconds']}s "
              f"最慢步骤 step{slow.get('step')}({slow.get('phase')}) {slow.get('seconds')}s "
              f"error={item['error'][:80]}")
    print('REPORT_SAVED:', report)


if __name__ == '__main__':
    main()
