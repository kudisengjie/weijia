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


async def _value():
    return {"text": "cached"}


if __name__ == "__main__":
    unittest.main()
