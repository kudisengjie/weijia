"""Probe real IMA knowledge bases: list KBs and file trees (no downloads yet)."""
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'cloud-functions'))

from geo_backend.ima import ima_post  # noqa: E402


async def main() -> None:
    creds = json.loads((ROOT / '.local' / 'verify-keys.json').read_text(encoding='utf-8'))
    credentials = {'clientId': creds['IMA_OPENAPI_CLIENTID'], 'apiKey': creds['IMA_OPENAPI_APIKEY']}
    async with __import__('httpx').AsyncClient(timeout=30.0) as client:
        # 1) find knowledge bases by targeted queries
        seen = {}
        for query in ('copilot', 'GEO', 'geo优化', '知识库'):
            try:
                data = await ima_post(credentials, 'openapi/wiki/v1/search_knowledge_base', {'query': query, 'cursor': '', 'limit': 20}, client=client)
            except Exception as error:  # noqa: BLE001
                print(f'QUERY {query!r} ERROR:', error)
                continue
            for kb in data.get('info_list', []):
                kb_id = str(kb.get('id') or kb.get('kb_id') or '')
                kb_name = str(kb.get('name') or kb.get('kb_name') or '')
                if kb_id:
                    seen[kb_id] = kb_name
        kbs = sorted(seen.items())
        print('=== KNOWLEDGE BASES ===')
        for kb_id, kb_name in kbs:
            print(kb_id, kb_name)
        names = kbs
        # 2) for each KB, walk the root file tree
        for kb_id, kb_name in names:
            print(f'=== TREE OF {kb_name} ({kb_id}) ===')
            cursor = ''
            for _page in range(10):
                payload = {'knowledge_base_id': kb_id, 'cursor': cursor, 'limit': 50}
                try:
                    tree = await ima_post(credentials, 'openapi/wiki/v1/get_knowledge_list', payload, client=client)
                except Exception as error:  # noqa: BLE001
                    print('  ERROR:', error)
                    break
                for item in tree.get('knowledge_list', []):
                    print(json.dumps({k: item.get(k) for k in ('folder_id', 'media_id', 'name', 'title', 'media_type', 'file_type')}, ensure_ascii=False))
                nxt = tree.get('next_cursor')
                if tree.get('is_end') is True or not nxt or nxt == cursor:
                    break
                cursor = nxt


if __name__ == '__main__':
    asyncio.run(main())
