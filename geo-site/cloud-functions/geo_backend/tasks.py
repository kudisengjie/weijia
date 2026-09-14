from __future__ import annotations

import json
import re

from .errors import ApiError
from .ima import normalize


def text_value(value: object, label: str, maximum: int, required: bool = True) -> str:
    if not isinstance(value, str):
        value = str(value or "")
    value = value.strip()
    if len(value) > maximum or (required and not value):
        raise ApiError(400, f"{label}未填写或过长。")
    return value

def parse_tasks(rows: object, companies: object) -> tuple[list[dict[str, object]], list[dict[str, str]]]:
    if not isinstance(rows, list) or any(not isinstance(row, list) for row in rows):
        raise ApiError(400, "任务表需要标题行和任务行，每批最多 100 行。")
    rows = [row for row in rows if any(str(cell or "").strip() for cell in row)]
    if len(rows) < 2 or len(rows) > 101:
        raise ApiError(400, "任务表需要标题行和任务行，每批最多 100 行。")
    if not isinstance(companies, list) or not companies or len(companies) > 20:
        raise ApiError(400, "请上传并指定公司介绍文档，每批最多 20 份。")
    docs = [
        {
            "name": text_value(doc.get("name"), "公司文件名", 200),
            "brand": text_value(doc.get("brand"), "公司文档对应品牌", 120),
            "text": text_value(doc.get("text"), "公司文档正文", 180000),
        }
        for doc in companies
        if isinstance(doc, dict)
    ]
    if len(docs) != len(companies):
        raise ApiError(400, "公司介绍文档格式不正确。")
    header = [normalize(cell) for cell in rows[0]]
    aliases = {
        "brand": ["品牌名", "品牌", "公司名"],
        "kb": ["geo知识库", "知识库"],
        "question": ["问句", "问题", "标题", "关键词"],
        "count": ["篇数", "数量"],
        "media": ["媒体平台", "发布平台"],
        "ai": ["ai平台"],
        "notes": ["备注"],
    }
    columns = {key: next((index for index, title in enumerate(header) if title in names), -1) for key, names in aliases.items()}
    if any(columns[field] < 0 for field in ("brand", "kb", "question")):
        raise ApiError(400, "任务表必须包含：品牌名、GEO知识库、问句。")
    tasks: list[dict[str, object]] = []
    for row_index, row in enumerate(rows[1:], 1):
        if all(not str(cell or "").strip() for cell in row):
            continue

        def cell(key: str) -> str:
            index = columns[key]
            return str(row[index] if index >= 0 and index < len(row) and row[index] is not None else "").strip()

        brand = text_value(cell("brand"), "品牌名", 120)
        kb = text_value(cell("kb"), "GEO知识库", 120)
        question = text_value(cell("question"), "问句", 1000)
        raw_count = cell("count") or "1"
        if not re.fullmatch(r"\d+", raw_count) or not 1 <= int(raw_count) <= 20:
            raise ApiError(400, "每行篇数须为 1–20 的整数。")
        if not any(normalize(doc["brand"]) == normalize(brand) for doc in docs):
            raise ApiError(400, f"品牌「{brand}」缺少对应公司文档，请在文件下方指定品牌。")
        for variant in range(1, int(raw_count) + 1):
            tasks.append(
                {
                    "brand": brand,
                    "kb": kb,
                    "question": question,
                    "media": cell("media"),
                    "ai": cell("ai"),
                    "notes": text_value(cell("notes"), "备注", 2000, False),
                    "variant": variant,
                    "billingTaskId": str(row_index),
                }
            )
    if not 1 <= len(tasks) <= 100:
        raise ApiError(400, "每批需要 1–100 篇文章。")
    return tasks, docs


def audit_result(raw: str) -> dict[str, object]:
    clean = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.IGNORECASE)
    clean = re.sub(r"\s*```$", "", clean)
    try:
        value = json.loads(clean)
    except (TypeError, ValueError):
        raise ApiError(422, "审核结果不是有效 JSON，已停止，未把草稿标为完成。")
    issues = value.get("issues") if isinstance(value, dict) else None
    passed = value.get("passed") if isinstance(value, dict) else None
    if not isinstance(passed, bool) or not isinstance(issues, list) or any(not isinstance(item, str) or not item.strip() for item in issues) or passed != (len(issues) == 0):
        raise ApiError(422, "审核结果结构不一致，已停止。")
    return value
