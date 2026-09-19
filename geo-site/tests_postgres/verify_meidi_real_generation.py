"""Real-credential end-to-end generation probe: 美迪电商教育 x DeepSeek.

Runs the PRODUCTION pipeline (BatchService + providers.complete) against the real
DeepSeek API on a disposable PostgreSQL schema, using the real 美迪公司介绍.docx as
company material and the real task question 学习淘宝运营哪家培训机构值得选择.

Secrets are read from .local/verify-keys.json (gitignored); the file is deleted in
the finally block. No secret is ever printed.
"""
import asyncio
import json
import re
import sys
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

DOCX = Path(r'C:/Users/潮汕炜佳/Desktop/美迪公司介绍.docx')
KEYS = ROOT / '.local' / 'verify-keys.json'
OUT = ROOT / 'output' / 'meidi-real'
QUESTION = '学习淘宝运营哪家培训机构值得选择'
BRAND = '美迪电商教育'


def docx_text(path: Path) -> str:
    with zipfile.ZipFile(path) as bundle:
        xml = bundle.read('word/document.xml').decode('utf-8')
    paragraphs = []
    for block in re.findall(r'<w:p[ >].*?</w:p>', xml, re.S):
        text = ''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', block))
        if text.strip():
            paragraphs.append(text.strip())
    return '\n'.join(paragraphs)


def main() -> None:
    keys = json.loads(KEYS.read_text(encoding='utf-8'))
    deepseek_key = keys['DEEPSEEK_API_KEY']
    text = docx_text(DOCX)
    print(f'company material: {len(text)} chars from {DOCX.name}')

    from test_runtime_integration import PostgresRuntimeTests, MASTER
    from geo_backend.models import SettingsService
    from geo_backend.batches import BatchService
    from geo_backend.providers import complete as real_complete

    PostgresRuntimeTests.setUpClass()
    fixture = PostgresRuntimeTests()
    fixture.setUp()
    try:
        fixture.fund(amount=10)
        SettingsService(fixture.repo, MASTER).save_model(
            fixture.owner, 'deepseek', 'primary', '', deepseek_key, False)
        service = BatchService(
            fixture.repo, MASTER,
            {'clientId': keys.get('IMA_OPENAPI_CLIENTID', ''), 'apiKey': keys.get('IMA_OPENAPI_APIKEY', '')},
            tenant_context=fixture.context,
            model_complete=real_complete,
        )
        body = {
            'requestId': str(uuid.uuid4()),
            'rows': [['品牌名', 'GEO知识库', '问句'], [BRAND, '品牌库', QUESTION]],
            'companies': [{'name': '美迪公司介绍.md', 'brand': BRAND, 'text': text}],
        }
        result = service.create(body, fixture.owner, datetime.now(timezone.utc) + timedelta(days=30))
        # Headless script cannot perform the browser-side local-delivery receipt;
        # pin legacy finalize-on-persist so the finished artifact lands in the DB.
        fixture.conn.execute("UPDATE batches SET delivery_mode = 'server_legacy' WHERE id = %s", (result['id'],))
        batch = fixture.repo.get_batch(fixture.owner, result['id'])
        # 三个独立信源（本机一次性夹具，模拟真实联网搜索的最少合规证据集）。
        web_sources = [
            {'title': '2026年中国电商代运营行业发展趋势观察', 'url': 'https://www.sohu.com/insight/26daiguo',
             'site': 'sohu.com', 'snippet': '电商代运营行业保持稳定增长，企业愈发重视人才体系化培养。'},
            {'title': '电商人才缺口与培训市场调研', 'url': 'https://www.163.com/edu/2026rcgap',
             'site': '163.com', 'snippet': '电商运营岗位人才缺口持续，系统化培训机构成为学习者主要选择。'},
            {'title': '淘宝运营学习者选机构关注因素分析', 'url': 'https://www.zhihu.com/market/2026xuanjigou',
             'site': 'zhihu.com', 'snippet': '学习者选机构时最关注实战课程、师资与就业支持。'},
        ]
        batch.update(
            phase='generate',
            rules={
                'generation': ['围绕问句与公司事实写一篇完整 GEO 文章，标题即问句，正文 1200 字以上；公司事实只使用公司资料，行业背景引用 webEvidence 来源；结尾自然引导了解美迪电商教育。'],
                'audit': ['核对文章中的公司事实均来自公司资料、行业事实均来自 webEvidence，无编造数据，无夸大宣传。'],
                'memory': [BRAND],
            },
            webSources=web_sources,
            webCache={QUESTION: web_sources},
        )
        assert fixture.repo.save_batch(fixture.owner, result['id'], batch, batch['seq'])
        for step in range(30):
            if result['status'] != 'ready':
                break
            result = asyncio.run(service.advance(result['id'], {'seq': result['seq']}, fixture.owner))
            print(f"step {step}: phase={result['phase']} status={result['status']} completed={result['completed']}")
        final = {k: result[k] for k in ('status', 'phase', 'completed', 'total', 'error')}
        print('final:', json.dumps(final, ensure_ascii=False))
        assert result['status'] == 'completed', final
        row = fixture.conn.execute(
            'SELECT id FROM article_artifacts WHERE batch_id = %s', (result['id'],)).fetchone()
        assert row, 'article artifact missing'
        article = fixture.repo.get_article_artifact(fixture.tenant, str(row[0]), MASTER, user_id=fixture.owner)
        OUT.mkdir(parents=True, exist_ok=True)
        target = OUT / (article['filename'] or 'meidi-article.md')
        Path(target).write_text(article['markdown'], encoding='utf-8')
        balance = fixture.repo.credit_balance(fixture.tenant, fixture.owner)
        print(f'balance after run: {balance}')
        print('ARTICLE_SAVED:', target)
        print('BYTE_LENGTH:', article['byteLength'])
    finally:
        fixture.doCleanups()
        PostgresRuntimeTests.tearDownClass()
        try:
            KEYS.unlink()  # never leave secrets on disk
            print('verify-keys.json deleted after use')
        except FileNotFoundError:
            pass


if __name__ == '__main__':
    main()
