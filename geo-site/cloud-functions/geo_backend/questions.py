"""问句查询服务（吕老师 2026-09-18 需求）。

流程：上传公司文档 → 模型读取并判断行业/核心业务/产品 → 联网搜索该行业消费者
常搜问句的线索 → 模型按九大维度产出排序后的问句清单（5-50 条，以推荐型问句为主，
但不允许每条问句都出现"推荐"二字）。

计费（吕老师确认）：预扣 1 积分（ledger kind=reserve，页面显示"任务预扣"）；
查询失败或未产出结果时全额返还（kind=refund，显示"未完成返还"）。
模型跟随账号默认模型（个人设置里保存的选择），不单独选模型。
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone

from .errors import ApiError
from .models import SettingsService
from .providers import complete
from .websearch import web_search

MIN_QUESTIONS = 5
MAX_QUESTIONS = 50
MAX_DOCS = 20
MAX_DOC_CHARS = 30000
MAX_TOTAL_CHARS = 200000
CHARGE_AMOUNT = 1

DIMENSIONS = (
    "搜索量（搜索频次、搜索增长趋势、稳定搜索/季节性搜索区分）；"
    "竞争度（首页对手实力、收录页面质量、域名权重、竞品布局密度）；"
    "商业价值（转化意向、付费意愿、客单价、变现路径）；"
    "用户搜索意图（信息型/调研型/对比型/交易型/导航型）；"
    "关键词匹配精准度（泛词、长尾精准词、同义衍生问句）；"
    "流量可持续性（短期热点词 vs 长期刚需词）；"
    "拓展衍生潜力（能否批量延伸同类问句、搭建词群矩阵）；"
    "平台适配门槛（内容创作难度、收录难度、合规限制）；"
    "搜索行为层级（决策链路阶段：初步了解→筛选对比→最终下单）"
)


def _json_block(text: str) -> object:
    """从模型回复中稳健地提取 JSON（容忍代码围栏与前后说明文字）。"""
    fenced = re.search(r"```(?:json)?\s*(.+?)\s*```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else text
    start = min((index for index in (candidate.find("["), candidate.find("{")) if index >= 0), default=-1)
    if start < 0:
        raise ApiError(502, "模型未返回有效结构，请重试。", "MODEL_BAD_FORMAT")
    depth = 0
    end = -1
    in_string = False
    escape = False
    for index in range(start, len(candidate)):
        char = candidate[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char in "[{":
            depth += 1
        elif char in "]}":
            depth -= 1
            if depth == 0:
                end = index + 1
                break
    if end < 0:
        raise ApiError(502, "模型未返回有效结构，请重试。", "MODEL_BAD_FORMAT")
    try:
        return json.loads(candidate[start:end])
    except ValueError:
        raise ApiError(502, "模型返回的 JSON 无法解析，请重试。", "MODEL_BAD_FORMAT") from None


class QuestionService:
    def __init__(self, repository: object, master_key: str, *, client=None, model_complete=complete) -> None:
        self.repository = repository
        self.master_key = master_key
        self.client = client
        self.model_complete = model_complete

    # ---------- 计费 ----------

    def _charge(self, tenant_id: str, user_id: str) -> str:
        key = "question-" + uuid.uuid4().hex
        try:
            self.repository.adjust_credits(tenant_id, user_id, CHARGE_AMOUNT, key, "reserve", allowed_kinds={'reserve'})
        except ValueError as error:
            raise ApiError(402, "积分不足，无法进行问句查询。", "INSUFFICIENT_CREDITS") from error
        return key

    def _refund(self, tenant_id: str, user_id: str) -> None:
        try:
            self.repository.adjust_credits(tenant_id, user_id, CHARGE_AMOUNT, "question-refund-" + uuid.uuid4().hex, "refund", allowed_kinds={'refund'})
        except ValueError:
            pass

    # ---------- 主流程 ----------

    async def discover(
        self, docs: list[dict[str, object]], count: int, user_id: str, tenant_id: str
    ) -> dict[str, object]:
        if not isinstance(count, int) or isinstance(count, bool) or not MIN_QUESTIONS <= count <= MAX_QUESTIONS:
            raise ApiError(400, f"问句数量需在 {MIN_QUESTIONS}-{MAX_QUESTIONS} 之间。", "INVALID_QUESTION_COUNT")
        cleaned = self._clean_docs(docs)
        charge_key = self._charge(tenant_id, user_id)
        try:
            analysis = await self._analyze(cleaned, user_id)
            evidence = await self._search(analysis)
            questions = await self._generate(analysis, evidence, count, user_id)
        except Exception:
            self._refund(tenant_id, user_id)
            raise
        if not questions:
            self._refund(tenant_id, user_id)
            raise ApiError(502, "未能产出问句清单，已返还 1 积分，请调整文档后重试。", "QUESTION_EMPTY")
        return {
            "analysis": analysis,
            "questions": questions,
            "charged": CHARGE_AMOUNT,
            "chargeKey": charge_key,
            "markdown": self._markdown(analysis, questions),
        }

    @staticmethod
    def _clean_docs(docs: list[dict[str, object]]) -> list[dict[str, str]]:
        if not isinstance(docs, list) or not 1 <= len(docs) <= MAX_DOCS:
            raise ApiError(400, f"请上传 1-{MAX_DOCS} 份公司文档。", "INVALID_QUESTION_DOCS")
        cleaned: list[dict[str, str]] = []
        total = 0
        for index, doc in enumerate(docs):
            name = str(doc.get("name") or f"文档{index + 1}")[:120]
            text = re.sub(r"\s+", " ", str(doc.get("text") or "")).strip()
            if not text:
                continue
            total += len(text)
            if total > MAX_TOTAL_CHARS:
                raise ApiError(413, "公司文档总字数超过 20 万，请精简后上传。", "QUESTION_DOCS_TOO_LARGE")
            cleaned.append({"name": name, "text": text[:MAX_DOC_CHARS]})
        if not cleaned:
            raise ApiError(400, "公司文档中没有可读取的文字内容。", "QUESTION_DOCS_EMPTY")
        return cleaned

    def _model_key(self, user_id: str) -> tuple[dict[str, str], str]:
        private = SettingsService(self.repository, self.master_key).private(user_id)
        model = private["model"]
        key = str(private["keys"].get(model["id"]) or "")
        if not key:
            raise ApiError(400, "请先在个人设置保存当前模型的 API Key。", "MODEL_KEY_MISSING")
        return model, key

    async def _analyze(self, docs: list[dict[str, str]], user_id: str) -> dict[str, object]:
        model, key = self._model_key(user_id)
        messages = [
            {"role": "system", "content": "你是行业分析助手。只返回 JSON，字段名固定为 industry（行业）、business（核心业务）、products（主要产品数组）、audience（目标客户），不要输出任何解释。"},
            {"role": "user", "content": json.dumps({"任务": "阅读公司文档，判断公司所处的领域/行业、核心业务、主要产品或服务、目标客户。", "文档": docs}, ensure_ascii=False)},
        ]
        raw = await self.model_complete(model, key, messages, client=self.client)
        data = _json_block(raw)
        if not isinstance(data, dict):
            raise ApiError(502, "模型未能判断公司行业，请补充文档后重试。", "QUESTION_ANALYSIS_FAILED")
        # 真实模型可能返回中文键名（如「行业」「主要产品」），做兼容映射。
        industry = str(data.get("industry") or data.get("行业") or data.get("领域") or "").strip()
        if not industry:
            raise ApiError(502, "模型未能判断公司行业，请补充文档后重试。", "QUESTION_ANALYSIS_FAILED")
        return {
            "industry": industry[:80],
            "business": str(data.get("business") or data.get("coreBusiness") or data.get("核心业务") or "")[:200],
            "products": [str(item)[:60] for item in (data.get("products") or data.get("主要产品") or [])[:8] if str(item).strip()],
            "audience": str(data.get("audience") or data.get("customers") or data.get("目标客户") or "")[:120],
        }

    async def _search(self, analysis: dict[str, object]) -> list[dict[str, object]]:
        """联网搜索该行业消费者常搜问句的线索；单路失败不致命，全部失败才报错。"""
        industry = str(analysis.get("industry") or "").strip()
        product = str((analysis.get("products") or [""])[0]).strip()
        queries = [f"{industry} 消费者 常见问题", f"{industry} 怎么选 哪家好"]
        if product:
            queries.insert(1, f"{product} 怎么选")
        queries.append(f"{industry} 购买 关注 因素")
        evidence: list[dict[str, object]] = []
        for query in queries[:4]:
            try:
                results = await web_search(query, client=self.client)
            except ApiError:
                results = []
            evidence.append({"query": query, "results": results})
        if not any(item["results"] for item in evidence):
            raise ApiError(502, "联网搜索暂不可用，已返还 1 积分，请稍后重试。", "QUESTION_SEARCH_FAILED")
        return evidence

    async def _generate(
        self, analysis: dict[str, object], evidence: list[dict[str, object]], count: int, user_id: str
    ) -> list[dict[str, object]]:
        model, key = self._model_key(user_id)
        contract = (
            "你是 GEO 问句策划专家。根据行业分析与联网搜索线索，产出消费者真实会搜索的问句清单。\n"
            f"必须以推荐类型问句为主（交易型/对比型意图优先），但问句表述要自然多样，"
            "禁止每条问句都出现「推荐」二字，用「哪家好/怎么选/值得选/哪一家更靠谱/避坑/排行榜」等自然轮换；"
            "问句中的行业与产品词必须来自分析结果，不得虚构具体品牌名；"
            "按以下维度综合排序（越靠前越优）：" + DIMENSIONS + "。\n"
            f"只返回 JSON 数组，正好 {count} 条，每条格式："
            '{"question":"问句","intent":"信息型|调研型|对比型|交易型|导航型","stage":"初步了解|筛选对比|最终下单","score":0-100整数,"reason":"20字内排序理由"}'
        )
        messages = [
            {"role": "system", "content": contract},
            {"role": "user", "content": json.dumps({"行业分析": analysis, "搜索线索": evidence, "需要数量": count}, ensure_ascii=False)},
        ]
        raw = await self.model_complete(model, key, messages, client=self.client)
        data = _json_block(raw)
        if not isinstance(data, list):
            raise ApiError(502, "模型未返回问句数组，请重试。", "MODEL_BAD_FORMAT")
        intents = {"信息型", "调研型", "对比型", "交易型", "导航型"}
        stages = {"初步了解", "筛选对比", "最终下单"}
        questions: list[dict[str, object]] = []
        for item in data[:count]:
            if not isinstance(item, dict):
                continue
            # 兼容真实模型可能返回的中文键名（问句/意图/阶段/评分/理由）。
            question = re.sub(r"\s+", " ", str(item.get("question") or item.get("问句") or "")).strip()
            if not 6 <= len(question) <= 60:
                continue
            intent = str(item.get("intent") or item.get("意图") or "信息型")
            stage = str(item.get("stage") or item.get("阶段") or "初步了解")
            try:
                score = max(0, min(100, int(item.get("score") or item.get("评分") or 0)))
            except (TypeError, ValueError):
                score = 0
            questions.append({
                "question": question,
                "intent": intent if intent in intents else "信息型",
                "stage": stage if stage in stages else "初步了解",
                "score": score,
                "reason": str(item.get("reason") or item.get("理由") or "")[:40],
            })
        return questions

    @staticmethod
    def _markdown(analysis: dict[str, object], questions: list[dict[str, object]]) -> str:
        products = "、".join(str(item) for item in analysis.get("products") or []) or "—"
        lines = [
            f"问句查询报告（{datetime.now(timezone.utc).astimezone().strftime('%Y-%m-%d %H:%M')}）",
            f"行业判断：{analysis.get('industry')}",
            f"核心业务：{analysis.get('business') or '—'}",
            f"主要产品：{products}",
            f"目标客户：{analysis.get('audience') or '—'}",
            "",
            f"推荐问句（共 {len(questions)} 条，按九大维度综合排序）：",
        ]
        for index, item in enumerate(questions, start=1):
            lines.append(
                f"{index}. {item['question']}（{item['intent']} · {item['stage']} · 评分 {item['score']}）"
                + (f" —— {item['reason']}" if item["reason"] else "")
            )
        lines.append("")
        lines.append("说明：以推荐类型问句为主，表述自然轮换，未逐条重复「推荐」二字；排序依据搜索量、竞争度、商业价值、搜索意图、关键词精准度、流量可持续性、拓展潜力、平台适配门槛与决策链路层级综合评估。")
        return "\n".join(lines)
