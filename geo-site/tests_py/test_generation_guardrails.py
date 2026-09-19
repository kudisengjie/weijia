"""生成链路加固（吕老师 2026-09-19 硬要求）的单元测试。

覆盖：审核 JSON 容错提取、规则文本兼容字典/字符串条目、生成提示词的
skills 流程硬约束与备注注入、批次摘要的阶段子进度 phaseDetail。
"""
import sys
import unittest
from pathlib import Path

FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
TESTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(FUNCTIONS_DIR))
sys.path.insert(0, str(TESTS_DIR))

from geo_backend.batches import _phase_detail, _rules_text, _summary, BatchService
from geo_backend.errors import ApiError
from geo_backend.tasks import audit_result


def batch_state(phase="generate", **overrides):
    state = {
        "id": "b" * 32,
        "model": {"id": "deepseek", "slot": "primary", "modelId": "m", "provider": "DeepSeek", "label": "DeepSeek"},
        "createdAt": "2026-09-19T00:00:00+00:00",
        "phase": phase,
        "seq": 3,
        "status": "ready",
        "error": "",
        "articles": [],
        "tasks": [{"brand": "零雪", "kb": "品牌库", "question": "零雪是什么？", "media": "", "ai": "", "notes": "", "variant": 1, "billingTaskId": "1"}],
        "companies": [{"name": "company.md", "brand": "零雪", "text": "零雪是一家内容服务品牌。"}],
        "requests": 5,
        "taskIndex": 0,
        "expiresAt": 0,
        "rules": {"generation": [], "audit": [], "memory": []},
        "failedTasks": [],
    }
    state.update(overrides)
    return state


class AuditResultTests(unittest.TestCase):
    def test_plain_json_passes(self):
        self.assertEqual({"passed": True, "issues": []}, audit_result('{"passed": true, "issues": []}'))

    def test_fenced_json_with_prose_tolerated(self):
        raw = '好的，审核结果如下：\n```json\n{"passed": false, "issues": ["来源缺失"]}\n```\n以上。'
        self.assertEqual({"passed": False, "issues": ["来源缺失"]}, audit_result(raw))

    def test_json_embedded_in_prose_tolerated(self):
        raw = '审核说明：本文存在以下问题。{"passed": false, "issues": ["数据无信源"]} 请修订。'
        self.assertEqual({"passed": False, "issues": ["数据无信源"]}, audit_result(raw))

    def test_no_json_raises(self):
        with self.assertRaises(ApiError):
            audit_result("完全不是 JSON 的回复")

    def test_structure_mismatch_raises(self):
        with self.assertRaises(ApiError):
            audit_result('{"passed": "yes", "issues": []}')


class RulesTextTests(unittest.TestCase):
    def test_dict_items_render_with_title(self):
        text = _rules_text([{"title": "geo-content-generator", "text": "第一条规范"}])
        self.assertIn("《geo-content-generator》", text)
        self.assertIn("第一条规范", text)

    def test_plain_string_items_tolerated(self):
        self.assertEqual("《规则文件》\n完整生成", _rules_text(["完整生成"]))

    def test_mixed_and_empty(self):
        text = _rules_text([{"title": "A", "text": "内容A"}, "内容B", {"title": "空", "text": "  "}])
        self.assertIn("内容A", text)
        self.assertIn("内容B", text)
        self.assertNotIn("《空》", text)
        self.assertEqual("（无）", _rules_text([]))


class PromptTests(unittest.TestCase):
    def prompt(self, stage, state):
        return BatchService._prompt(state, stage)

    def test_generate_has_skills_contract_and_no_draft(self):
        state = batch_state("generate", rules={"generation": [{"title": "geo-content-generator", "text": "流程"}], "audit": [], "memory": []})
        messages = self.prompt("generate", state)
        self.assertEqual(2, len(messages))
        system = messages[0]["content"]
        self.assertIn("geo-content-generator", system)
        self.assertIn("文章正文本身", system)
        self.assertNotIn("draft", messages[1]["content"])

    def test_generate_injects_task_notes(self):
        state = batch_state("generate")
        state["tasks"][0]["notes"] = "侧重零基础学员"
        system = self.prompt("generate", state)[0]["content"]
        self.assertIn("侧重零基础学员", system)

    def test_audit_includes_draft_and_json_only(self):
        state = batch_state("audit", draft="草稿正文", rules={"generation": [], "audit": [{"title": "geo-audit", "text": "审核规范"}], "memory": []})
        messages = self.prompt("audit", state)
        self.assertIn("geo-audit", messages[0]["content"])
        self.assertIn("草稿正文", messages[1]["content"])
        self.assertIn("JSON", messages[0]["content"])


class PhaseDetailTests(unittest.TestCase):
    def test_generate_phase_detail(self):
        state = batch_state("generate", taskIndex=0)
        detail = _summary(state)["phaseDetail"]
        self.assertIn("第 1/1 条", detail)
        self.assertIn("生成", detail)

    def test_rule_text_progress(self):
        state = batch_state("ruleText", ruleTotal=6, ruleFiles=[1, 2])
        self.assertIn("4/6", _summary(state)["phaseDetail"])

    def test_done_empty_detail(self):
        self.assertEqual("", _summary(batch_state("done"))["phaseDetail"])


if __name__ == "__main__":
    unittest.main()
