"""Download the GEO rule/skill corpus from real IMA knowledge bases.

Scope (user directive 2026-09-18):
- copilot KB: read EVERYTHING (geo-content-generator skills, geo-audit skills, memory archive).
- GEO优化知识库: read ONLY the folders on the user's approved list
  (豆包AI platform folder, GEO三标准合规_V3, 跨平台通用参考, 速查校准信号).
- 美迪电商教育知识库: brand evidence (root files; weburl entries are skipped).

Files are written to .local/geo-kb/<bucket>/ as plain text for the generation step.
"""
import asyncio
import json
import re
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'cloud-functions'))

from geo_backend.ima import ima_post, read_media  # noqa: E402

OUT = ROOT / '.local' / 'geo-kb'
SAFE = re.compile(r'[\\/:*?"<>|\s]+')


def slug(title: str) -> str:
    return SAFE.sub('_', title.strip())[:80]


async def list_folder(credentials, client, kb_id, folder_id):
    items, cursor = [], ''
    for _page in range(10):
        payload = {'knowledge_base_id': kb_id, 'cursor': cursor, 'limit': 50}
        if folder_id:
            payload['folder_id'] = folder_id
        data = await ima_post(credentials, 'openapi/wiki/v1/get_knowledge_list', payload, client=client)
        items.extend(data.get('knowledge_list', []))
        nxt = data.get('next_cursor')
        if data.get('is_end') is True or not nxt or nxt == cursor:
            break
        cursor = nxt
    return items


async def main() -> None:
    creds = json.loads((ROOT / '.local' / 'verify-keys.json').read_text(encoding='utf-8'))
    credentials = {'clientId': creds['IMA_OPENAPI_CLIENTID'], 'apiKey': creds['IMA_OPENAPI_APIKEY']}
    plan = [
        # (bucket, kb_name, folders-or-None-for-root, include_root_files)
        ('copilot', 'copilot', ['geo-content-generator', 'geo-audit'], True),
        ('geo-std', 'GEO优化知识库', ['GEO三标准合规_V3', '跨平台通用参考', 'GEO其他合规标准_速查校准信号', '豆包AI'], False),
        ('meidi', '美迪电商教育知识库', None, True),
    ]
    async with httpx.AsyncClient(timeout=60.0) as client:
        # resolve KB ids
        data = await ima_post(credentials, 'openapi/wiki/v1/search_knowledge_base', {'query': '', 'cursor': '', 'limit': 20}, client=client)
        kb_ids = {str(kb.get('kb_name')): str(kb.get('kb_id')) for kb in data.get('info_list', [])}
        for bucket, kb_name, folders, include_root in plan:
            kb_id = kb_ids[kb_name]
            targets = []
            if folders is None or include_root:
                root_items = await list_folder(credentials, client, kb_id, '')
                for item in root_items:
                    if item.get('media_type') == 99:
                        if folders and item.get('title') in folders:
                            targets.append((item.get('title'), item.get('media_id'), ''))
                    else:
                        targets.append(('', item.get('media_id'), str(item.get('title') or '')))
            elif folders:
                for title, media_id in [(i.get('title'), i.get('media_id')) for i in await list_folder(credentials, client, kb_id, '')]:
                    if title in folders:
                        targets.append((title, media_id, ''))
            outdir = OUT / bucket
            outdir.mkdir(parents=True, exist_ok=True)
            print(f'=== {bucket} ({kb_name}) ===')
            for folder_title, media_id, own_title in targets:
                if str(media_id).startswith('folder_'):
                    for item in await list_folder(credentials, client, kb_id, media_id):
                        if item.get('media_type') == 99:
                            print(f'  SKIP nested folder: {item.get("title")}')
                            continue
                        await download(credentials, client, outdir, folder_title, item)
                else:
                    await download(credentials, client, outdir, folder_title, {'media_id': media_id, 'title': own_title})


async def download(credentials, client, outdir, folder_title, item) -> None:
    title = str(item.get('title') or item.get('name') or item.get('media_id'))
    prefix = f'{folder_title}_' if folder_title else ''
    try:
        media = await read_media(credentials, {'media_id': item['media_id'], 'title': title}, client=client)
    except Exception as error:  # noqa: BLE001
        print(f'  SKIP {prefix}{title}: {error}')
        return
    target = outdir / f'{prefix}{slug(title)}.txt'
    target.write_text(media['text'], encoding='utf-8')
    print(f'  saved {target.name}: {len(media["text"])} chars')


if __name__ == '__main__':
    asyncio.run(main())
