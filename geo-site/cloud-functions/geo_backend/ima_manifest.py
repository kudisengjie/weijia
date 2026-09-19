"""IMA 知识库文件级获取清单（吕老师 2026-09-19 长图现场核验版）。

GEO优化核心知识库：13 个文件夹、89 个文件。两个 skill（geo-content-generator
V3.58 / geo-audit V3.52）只读取其中一部分；本模块把「必读 / 条件读取 / 不读取」
固化为代码，供预热（ima_warm）与生成链路（batches 标准包注入）共同执行——
两边永远引用同一份清单，绝不允许口径漂移。

清单结论（与长图逐一对应）：
- 整夹不读取：新华网（2）、Google Gemini（3）、GEO学习记录（34）、旧版归档（空）；
- 文件级不读取：课堂校准信号夹 4 份复核/团标文件、跨平台通用参考 3 份速查类、
  豆包AI夹 2 份专项研究（抖音指南/多模态）；
- 其余全部获取：六平台专属夹的平台 4 件套 + 条件件（豆包21清单、豆包AI抓取、
  DeepSeek_大数据流）、跨平台通用参考 9 份、GEO三标准合规_V3 全部 4 份、
  课堂校准信号夹的 合规课堂_V1.6 与 国家GEO标准_V1.2；
- 品牌知识库（如 美迪电商教育知识库）不在本库约束内——由任务指定后全量读取。
"""
from __future__ import annotations

GEO_KB_NAME = "GEO优化知识库"

# 整夹不读取（学习专用 / 权威标准周学习 / 专项研究，两 skill 均未引用）。
SKIP_FOLDERS = (
    "新华网",
    "Google Gemini",
    "GEO学习记录",
    "旧版归档",
)

# 文件名级不读取（所在夹同时含必读文件，必须逐名排除，不能整夹跳过）。
SKIP_FILES = (
    # 豆包AI夹：专项研究文件，不在生成/审核加载清单
    "豆包_抖音指南",
    "豆包_多模态",
    # 跨平台通用参考：学习参考，两 skill 未引用
    "GEO快速速查",
    "多模态GEO指南",
    "AI代理搜索报告",
    # 课堂校准信号夹：学习/复核记录，非生成审核依据
    "育广协团标",
    "GEO信号校准",
    "三标准复核结论",
    # 新华网 / Google Gemini 夹内文件（双保险，正常已被整夹跳过）
    "新华网 GEO标准与规范",
    "GEO内置倡议书",
    "谷歌GEO指南",
    "Gemini GEO",
    "Google_EEAT",
)

# 六平台专属夹的平台名 token（按文件夹名或文件名前缀匹配，如「元宝_抓取_V3.md」）。
PLATFORM_TOKENS = (
    "元宝",
    "豆包",
    "DeepSeek",
    "Kimi",
    "千问",
    "文心",
)

# 生成阶段（geo-content-generator V3.58）无条件必读的通用文件标题 token。
GENERATION_UNIVERSAL = (
    "GEO生成标准_V5.26",
    "GEO蓝图_V8.9.4",
    "AI意图框架_V1.7",
    "品牌浓度_V4.8.3",
    "维度池_V4.4",
    "三维组合空间生成规范_V2.2",
)

# 审核阶段（geo-audit V3.52）在共同文件之外追加必读。
AUDIT_EXTRA = (
    "PRIME方法论",
    "SGPE引擎",
    "合规课堂",
    "国家GEO标准",
)

# 共同必读（生成与审核都要）：GEO三标准合规_V3。
THREE_STANDARDS = (
    "GEO_违规标准_V3.24",
    "GEO_营销标准_V3.18",
    "GEO_AI味标准_V3.14",
)

# 平台 4 件套的文件名特征（平台名_抓取/模版/媒体/实操）。
PLATFORM_FILE_KINDS = ("_抓取", "_模版", "_媒体", "_实操")


def folder_action(title: str) -> tuple[bool, str]:
    """目录展开时调用：返回 (是否下钻/获取该夹内容, 原因)。"""
    name = str(title or "")
    for token in SKIP_FOLDERS:
        if token in name:
            return False, f"清单整夹不读取（{token}）"
    return True, "清单允许"


def file_action(title: str) -> tuple[bool, str]:
    """文件条目时调用：返回 (是否获取, 原因)。"""
    name = str(title or "")
    for token in SKIP_FILES:
        if token in name:
            return False, f"清单文件级不读取（{token}）"
    return True, "清单必读/条件读取"


def platform_of(title: str) -> str | None:
    """识别平台 4 件套文件所属平台（按「平台名_抓取/模版/媒体/实操」命名）。"""
    name = str(title or "")
    for token in PLATFORM_TOKENS:
        for kind in PLATFORM_FILE_KINDS:
            if name.startswith(token) and kind in name:
                return token
    return None


def index_request(kb_id: str) -> dict[str, object]:
    """清单索引的缓存请求体（预热写入与链路读取必须用同一份，键才一致）。"""
    return {"endpoint": "manifest-index", "manifestIndex": str(kb_id)}


def selection_for(stage: str, ai_platform: str, media_platform: str) -> list[str]:
    """返回该阶段需要注入的文件标题 token 清单（按优先级从高到低）。

    stage: "generation" | "audit"；ai_platform/media_platform 来自任务行
    （AI平台 / 媒体平台 列），可能为空——为空时只注入共同必读。
    """
    tokens: list[str] = []
    ai = str(ai_platform or "").strip()
    media = str(media_platform or "").strip()
    if ai:
        for token in PLATFORM_TOKENS:
            if token.lower() in ai.lower():
                for kind in PLATFORM_FILE_KINDS:
                    tokens.append(f"{token}{kind}")
                break
    tokens.extend(THREE_STANDARDS)
    tokens.extend(GENERATION_UNIVERSAL)
    if stage == "audit":
        tokens.extend(AUDIT_EXTRA)
    # 条件件（长图 2.2 / 3.2）。
    if media and "今日头条" in media:
        tokens.append("今日头条内容规范")
    if ai and "豆包" in ai:
        tokens.append("豆包21清单")
        if stage == "audit":
            tokens.append("豆包AI抓取")
    if ai and "deepseek" in ai.lower():
        tokens.append("DeepSeek_大数据流")
    return tokens
