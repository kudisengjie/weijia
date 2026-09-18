import sys
import unittest
from pathlib import Path


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))


class CacheRepository:
    def __init__(self):
        self.generation = 1
        self.values = {}
        self.puts = 0

    def get_ima_cache_generation(self):
        return self.generation

    def get_ima_cache(self, kind, key, generation, _master_key=None):
        return self.values.get((kind, key, generation))

    def put_ima_cache(self, kind, key, generation, value, metadata, _master_key=None):
        self.values[(kind, key, generation)] = value
        self.puts += 1

    def clear_ima_cache_generation(self, _user_id=None):
        self.generation += 1
        return self.generation


class ImaCacheTests(unittest.IsolatedAsyncioTestCase):
    def test_identifiers_cursors_and_query_words_do_not_collide(self):
        from geo_backend.ima import ImaCache
        for field, first, second in [('mediaId', 'AbC', 'abc'), ('cursor', 'A B', 'AB'),
                                     ('query', 'a b', 'ab'), ('query', 'US', 'us')]:
            self.assertNotEqual(ImaCache.key('search', {field: first}), ImaCache.key('search', {field: second}))

    async def test_cache_is_rechecked_after_winning_lock(self):
        from geo_backend.ima import ImaCache
        repository = CacheRepository()
        def acquire(key, generation, token, seconds):
            repository.values[('media', key, generation)] = {'text': 'other request finished'}
            return True
        repository.acquire_ima_cache_lock = acquire
        repository.release_ima_cache_lock = lambda *args: None
        async def forbidden():
            self.fail('Cache filled before lock acquisition must not be fetched twice')
        value = await ImaCache(repository).get_or_fetch('media', {'mediaId': 'm'}, forbidden)
        self.assertEqual('other request finished', value['text'])

    async def test_search_hit_is_shared_and_does_not_call_upstream_again(self):
        from geo_backend.ima import ImaCache

        repository = CacheRepository()
        cache = ImaCache(repository)
        calls = 0

        async def fetch():
            nonlocal calls
            calls += 1
            return {"info_list": [{"media_id": "m1"}], "is_end": True}

        first = await cache.get_or_fetch("search", {"knowledgeBaseId": "kb-1", "query": "零雪"}, fetch)
        second = await cache.get_or_fetch("search", {"knowledgeBaseId": "kb-1", "query": " 零雪 "}, fetch)

        self.assertEqual(first, second)
        self.assertEqual(1, calls)
        self.assertEqual(1, repository.puts)

    async def test_clear_generation_invalidates_old_values(self):
        from geo_backend.ima import ImaCache

        repository = CacheRepository()
        cache = ImaCache(repository)
        await cache.get_or_fetch("media", {"knowledgeBaseId": "kb-1", "mediaId": "m1"}, lambda: _value())
        cache.clear_generation()
        calls = 0

        async def fetch_again():
            nonlocal calls
            calls += 1
            return {"text": "fresh"}

        value = await cache.get_or_fetch("media", {"knowledgeBaseId": "kb-1", "mediaId": "m1"}, fetch_again)

        self.assertEqual({"text": "fresh"}, value)
        self.assertEqual(1, calls)

    async def test_read_only_mode_never_fetches_and_reports_stale(self):
        # 子账号只读缓存：未命中时必须明确报错，绝不直连 IMA 上游。
        from geo_backend.errors import ApiError
        from geo_backend.ima import ImaCache

        repository = CacheRepository()
        cache = ImaCache(repository)
        calls = 0

        async def forbidden():
            nonlocal calls
            calls += 1
            return {"text": "upstream"}

        with self.assertRaises(ApiError) as raised:
            await cache.get_or_fetch("media", {"knowledgeBaseId": "kb-1", "mediaId": "m1"}, forbidden, allow_fetch=False)
        self.assertEqual("IMA_CACHE_STALE", raised.exception.code)
        self.assertEqual(0, calls)
        self.assertEqual(0, repository.puts)

    async def test_force_refresh_skips_cached_value_and_refetches(self):
        # 主账号到期更新：强制跳过缓存重读上游，并写回同代缓存。
        from geo_backend.ima import ImaCache

        repository = CacheRepository()
        cache = ImaCache(repository)
        await cache.get_or_fetch("media", {"knowledgeBaseId": "kb-1", "mediaId": "m1"}, _value)
        calls = 0

        async def fetch_fresh():
            nonlocal calls
            calls += 1
            return {"text": "refreshed"}

        value = await cache.get_or_fetch(
            "media", {"knowledgeBaseId": "kb-1", "mediaId": "m1"}, fetch_fresh, force_refresh=True)

        self.assertEqual({"text": "refreshed"}, value)
        self.assertEqual(1, calls)
        self.assertEqual(2, repository.puts)


async def _value():
    return {"text": "cached"}


if __name__ == "__main__":
    unittest.main()
