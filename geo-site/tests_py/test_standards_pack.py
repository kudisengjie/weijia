"""吕老师 2026-09-19 长图清单 + 标准包注入的单元测试。

清单铁律：预热（ima_warm）与生成链路（batches._standards_pack）共用
ima_manifest.py 的同一份口径；标准包只读缓存、绝不发起上游请求、
缺文件整份记录并跳过（不截断、不静默降级）。
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))

from geo_backend import ima_manifest as manifest
from geo_backend.ima import ImaCache


class ManifestRulesTests(unittest.TestCase):
    def test_skip_folders_cover_learning_and_research_folders(self):
        for token in ("新华网", "Google Gemini", "GEO学习记录", "旧版归档"):
            allowed, why = manifest.folder_action(token + "（2个）")
            self.assertFalse(allowed, token)
            self.assertIn("整夹不读取", why)

    def test_normal_folders_are_allowed(self):
        for name in ("跨平台通用参考", "GEO三标准合规_V3", "豆包AI", "DeepSeek", "GEO其他合规标准_课堂校准信号"):
            allowed, _ = manifest.folder_action(name)
            self.assertTrue(allowed, name)

    def test_skip_files_are_rejected_everywhere(self):
        skipped = [
            "豆包_抖音指南_V1.3.md", "豆包_多模态_V1.3.md",
            "GEO快速速查_V3.6.md", "多模态GEO指南_V1.2.md", "AI代理搜索报告_V1.0.md",
            "育广协团标_V1.1.md", "GEO信号校准_V1.1.md",
            "三标准复核结论_20260914.md", "三标准复核结论_20260507.md",
            "谷歌GEO指南_V2.7.md", "Gemini GEO_V1.8.md", "Google_EEAT_V1.0.md",
        ]
        for name in skipped:
            allowed, why = manifest.file_action(name)
            self.assertFalse(allowed, name)
            self.assertIn("文件级不读取", why)

    def test_required_files_are_allowed(self):
        required = [
            "元宝_抓取_V3.md", "元宝_模版_V2.md", "元宝_媒体_V1.md", "元宝_实操_V4.md",
            "豆包_抓取_V4.md", "DeepSeek_模版_V1.md",
            "GEO生成标准_V5.26_20260901.md", "GEO蓝图_V8.9.4.md", "AI意图框架_V1.7.md",
            "品牌浓度_V4.8.3_20260901.md", "维度池_V4.4.md", "三维组合空间生成规范_V2.2_20260831.md",
            "PRIME方法论_V1.4.md", "SGPE引擎_V1.3.md", "标题公式_V1.4.md",
            "GEO_违规标准_V3.24.md", "GEO_营销标准_V3.18.md", "GEO_AI味标准_V3.14.md",
            "今日头条内容规范_统一版V2.0.md", "豆包21清单_V1.2.md", "豆包AI抓取_V3.6.md",
            "DeepSeek_大数据流_V1.2.md", "合规课堂_V1.6.md", "国家GEO标准_V1.2.md",
        ]
        for name in required:
            allowed, _ = manifest.file_action(name)
            self.assertTrue(allowed, name)

    def test_platform_of_matches_platform_file_family(self):
        self.assertEqual("元宝", manifest.platform_of("元宝_抓取_V3.md"))
        self.assertEqual("DeepSeek", manifest.platform_of("DeepSeek_实操_V2.md"))
        self.assertIsNone(manifest.platform_of("GEO生成标准_V5.26_20260901.md"))
        self.assertIsNone(manifest.platform_of("豆包_抖音指南_V1.3.md"))  # 不在 4 件套命名内

    def test_selection_generation_includes_platform_and_standards(self):
        tokens = manifest.selection_for("generation", "元宝", "公众号")
        for token in ("元宝_抓取", "元宝_模版", "元宝_媒体", "元宝_实操",
                      "GEO_违规标准_V3.24", "GEO生成标准_V5.26", "维度池_V4.4"):
            self.assertIn(token, tokens)
        self.assertNotIn("PRIME方法论", tokens)  # 审核专属
        self.assertNotIn("今日头条内容规范", tokens)  # 媒体=公众号 不触发

    def test_selection_audit_adds_audit_extra_and_conditionals(self):
        tokens = manifest.selection_for("audit", "豆包", "今日头条")
        for token in ("PRIME方法论", "SGPE引擎", "合规课堂", "国家GEO标准",
                      "豆包21清单", "豆包AI抓取", "今日头条内容规范", "豆包_抓取"):
            self.assertIn(token, tokens)

    def test_selection_without_platform_still_includes_common_standards(self):
        tokens = manifest.selection_for("generation", "", "")
        self.assertIn("GEO_营销标准_V3.18", tokens)
        self.assertTrue(all(not token.startswith(("元宝_", "豆包_")) for token in tokens))

    def test_index_request_is_stable(self):
        self.assertEqual(manifest.index_request("kb-1"), manifest.index_request("kb-1"))
        self.assertNotEqual(manifest.index_request("kb-1"), manifest.index_request("kb-2"))


class FakeRepository:
    def __init__(self):
        self.ima_cache_generation = 1
        self.ima_cache_values = {}

    def get_ima_cache_generation(self):
        return self.ima_cache_generation

    def get_ima_cache(self, kind, key, generation, _master_key=None):
        return self.ima_cache_values.get((kind, key, generation))

    def put_ima_cache(self, kind, key, generation, value, _metadata, _master_key=None, *, label=None):
        self.ima_cache_values[(kind, key, generation)] = value


def make_service():
    from geo_backend.batches import BatchService

    async def model_complete(*_args, **_kwargs):
        return "OK"

    return BatchService(FakeRepository(), "master", {"clientId": "c", "apiKey": "k"}, model_complete=model_complete)


def seed_index(repo: FakeRepository, geo_id: str, files: list[dict]):
    key = ImaCache.key("search", manifest.index_request(geo_id), 1)
    repo.ima_cache_values[("search", key, 1)] = {"kbId": geo_id, "generation": 1, "files": files}


def seed_media(repo: FakeRepository, geo_id: str, media_id: str, title: str, text: str):
    key = ImaCache.key("media", {"knowledgeBaseId": geo_id, "mediaId": media_id}, 1)
    repo.ima_cache_values[("media", key, 1)] = {"title": title, "text": text}


class StandardsPackTests(unittest.IsolatedAsyncioTestCase):
    BATCH = {"bases": [{"name": "GEO优化知识库", "id": "kb-geo"}], "imaCacheGeneration": 1,
             "tasks": [{"ai": "元宝", "media": "公众号", "brand": "零雪"}]}

    async def test_injects_cached_files_for_generation_stage(self):
        service = make_service()
        repo = service.repository
        seed_index(repo, "kb-geo", [
            {"mediaId": "m1", "title": "元宝_抓取_V3.md", "include": True},
            {"mediaId": "m2", "title": "GEO_违规标准_V3.24.md", "include": True},
            {"mediaId": "m3", "title": "PRIME方法论_V1.4.md", "include": True},
        ])
        seed_media(repo, "kb-geo", "m1", "元宝_抓取_V3.md", "抓取规范正文")
        seed_media(repo, "kb-geo", "m2", "GEO_违规标准_V3.24.md", "违规词库正文")

        batch = {**self.BATCH, "tasks": [dict(self.BATCH["tasks"][0])]}
        text = await service._standards_pack(batch, "generate", batch["tasks"][0])

        self.assertIn("抓取规范正文", text)
        self.assertIn("违规词库正文", text)
        self.assertIn("元宝_抓取_V3.md", text)
        self.assertNotIn("PRIME方法论", text)  # 审核专属文件不出现在生成阶段
        self.assertEqual([], batch["standardsMissing"])
        self.assertGreater(batch["standardsChars"], 0)

    async def test_missing_media_is_recorded_not_fetched(self):
        service = make_service()
        repo = service.repository
        seed_index(repo, "kb-geo", [
            {"mediaId": "m1", "title": "元宝_抓取_V3.md", "include": True},
            {"mediaId": "mx", "title": "GEO_营销标准_V3.18.md", "include": True},
        ])
        seed_media(repo, "kb-geo", "m1", "元宝_抓取_V3.md", "抓取规范正文")

        batch = {**self.BATCH, "tasks": [dict(self.BATCH["tasks"][0])]}
        text = await service._standards_pack(batch, "generate", batch["tasks"][0])

        self.assertIn("抓取规范正文", text)
        self.assertEqual(["GEO_营销标准_V3.18.md（正文未预热）"], batch["standardsMissing"])

    async def test_missing_index_returns_empty_with_guidance(self):
        service = make_service()
        batch = {**self.BATCH, "tasks": [dict(self.BATCH["tasks"][0])]}
        text = await service._standards_pack(batch, "generate", batch["tasks"][0])
        self.assertEqual("", text)
        self.assertTrue(any("清单索引缺失" in item for item in batch["standardsMissing"]))

    async def test_missing_geo_base_returns_empty(self):
        service = make_service()
        batch = {"bases": [{"name": "copilot", "id": "kb-c"}], "imaCacheGeneration": 1,
                 "tasks": [{"ai": "", "media": "", "brand": "x"}]}
        text = await service._standards_pack(batch, "generate", batch["tasks"][0])
        self.assertEqual("", text)
        self.assertTrue(any("不在批次扫描结果" in item for item in batch["standardsMissing"]))

    async def test_repair_stage_uses_audit_ruler(self):
        service = make_service()
        repo = service.repository
        seed_index(repo, "kb-geo", [{"mediaId": "p1", "title": "PRIME方法论_V1.4.md", "include": True}])
        seed_media(repo, "kb-geo", "p1", "PRIME方法论_V1.4.md", "T3 评分方法")

        batch = {**self.BATCH, "tasks": [dict(self.BATCH["tasks"][0])]}
        text = await service._standards_pack(batch, "repair", batch["tasks"][0])
        self.assertIn("T3 评分方法", text)

    async def test_oversized_file_is_dropped_whole_not_truncated(self):
        service = make_service()
        repo = service.repository
        seed_index(repo, "kb-geo", [
            {"mediaId": "big", "title": "GEO生成标准_V5.26_20260901.md", "include": True},
            {"mediaId": "ok", "title": "维度池_V4.4.md", "include": True},
        ])
        seed_media(repo, "kb-geo", "big", "GEO生成标准_V5.26_20260901.md", "巨" * (service.STANDARDS_CHAR_CAP + 1))
        seed_media(repo, "kb-geo", "ok", "维度池_V4.4.md", "维度池正文")

        batch = {**self.BATCH, "tasks": [dict(self.BATCH["tasks"][0])]}
        text = await service._standards_pack(batch, "generate", batch["tasks"][0])

        self.assertIn("维度池正文", text)
        self.assertNotIn("巨" * 1000, text)
        self.assertTrue(any("超出标准包容量上限" in item for item in batch["standardsMissing"]))

    async def test_non_model_stages_return_empty(self):
        service = make_service()
        batch = {**self.BATCH, "tasks": [dict(self.BATCH["tasks"][0])]}
        for stage in ("bases", "rules", "websearch"):
            self.assertEqual("", await service._standards_pack(batch, stage, batch["tasks"][0]))


if __name__ == "__main__":
    unittest.main()
