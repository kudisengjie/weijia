"""真实组件验证：真实搜狗联网搜索 + 真实 DeepSeek 生成 + 真实审计提示词。
只用 .local/verify-keys.json 中的真实密钥，不打印任何密钥值。"""
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'cloud-functions'))
sys.path.insert(0, str(ROOT))

from geo_backend.websearch import web_search  # noqa: E402

QUESTION = '电商代运营公司怎么选？'


async def main() -> int:
    keys = json.loads((ROOT / '.local' / 'verify-keys.json').read_text(encoding='utf-8'))

    print('[1/3] 真实搜狗联网搜索…')
    results = await web_search(QUESTION)
    print(f'  搜索返回 {len(results)} 条：')
    for item in results[:3]:
        print('   -', item.get('site', ''), '|', item.get('title', '')[:40])

    print('[2/3] 真实 DeepSeek 生成（带联网证据）…')
    from geo_backend import providers
    evidence = '\n'.join(f"[{r['site']}] {r['title']}：{r['snippet'][:120]}" for r in results)
    system = (
        '你是资深 GEO 内容专家。严格依据提供的联网搜索证据写作，开头引用 1-2 条“据××”式来源；'
        '核心事实至少 3 个独立信源支撑；禁止编造来源；输出纯文章正文，不要 Markdown 标记。'
    )
    prompt = f'问句：{QUESTION}\n\n联网搜索证据：\n{evidence}\n\n请写一篇 600 字左右的 GEO 干货文章。'
    text = await providers.complete(
        {'id': 'deepseek', 'provider': 'DeepSeek', 'modelId': 'deepseek-flash', 'endpoint': 'https://api.deepseek.com/chat/completions'},
        keys['DEEPSEEK_API_KEY'],
        [{'role': 'system', 'content': system}, {'role': 'user', 'content': prompt}],
    )
    print('  生成字数：', len(text))
    print('  开头 120 字：', text[:120].replace('\n', ' '))

    print('[3/3] 校验生成内容合规点…')
    checks = {
        '包含来源引用（据××）': ('据' in text[:200]),
        '非空且长度合理': 300 <= len(text) <= 3000,
        '无编造链接': 'http' not in text.lower(),
    }
    for name, ok in checks.items():
        print(f'   {"PASS" if ok else "FAIL"} - {name}')
    if not all(checks.values()):
        return 1
    print('REAL_COMPONENT_REPORT: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
