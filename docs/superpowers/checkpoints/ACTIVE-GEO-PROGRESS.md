# 零雪 GEO 当前检查点

更新时间：2026-09-14。本文件只记录可复核的实现、验证和明确未完成项；本地、GitHub、EdgeOne 三层状态分开记录，不把“已保存”“已推送”“已部署”混为一谈。

## 当前接续重点（优先于下方历史测试）

ce83602 是 SaaS 原型检查点，不是已完成的发布版。此前 58 项 Python 测试主要使用内存替身，没有证明真实数据库事务正确。2026-09-14 增量修复阶段见提交 `fix: validate SaaS transactions against real PostgreSQL`。tests_postgres/test_runtime_integration.py 在本机隔离 PostgreSQL 的 25 项验证已全部通过：批次/预扣/快照原子创建、并发幂等、子账号余额隔离、积分收回、反复重试退款台账、长问句缓存、按 Excel 行而非篇数扣分、五行四成功一失败净扣四分、文件与状态事务回滚、中文文件名下载与账号隔离、文件不可覆盖、旧 owner 登录迁移、最新订阅优先、owner 专属充值和缓存管理、模型锁定、到期拦截、取消退款、过期 claim 跳过退款而不重发、Worker 租约令牌/忙碌重排队/无浏览器完成文章/CLI --once。

本轮 Python 58 项旧测试全量时唯一失败来自测试替身缺少新增幂等查询；补齐替身后对应 batch 与 worker 7 项全部通过。未重复运行代码未变的 Node/PC 验证。git diff --check 已通过。测试只使用临时隔离数据库和模拟上游模型，未调用线上客户密钥或产生模型费用。

后续必须完成：IMA 缓存代际/大小写/凭据更新保留缓存及搜索协议；管理界面选择子账号、续期和流水；运行页取消/退款展示/全局模型锁；订阅调整目标校验与审计；旧会话初始化；Worker 到期后的退款/暂停语义、生产部署文档和真实浏览器联调。新 Worker CLI 在本机可运行，但尚未部署到独立主机；只有 EdgeOne 并不等于已有后台常驻进程。禁止直接把未完成版本推送到线上。

## 从这里接续

- 当前工作树：`E:/codex/weijia/.worktrees/static-geo-model-catalog`
- 当前分支：`feat/static-geo-model-catalog`
- 发布目标：`kudisengjie/weijia` 的 `master`，用户已授权推送。
- GEO 子站目录：`geo-site`
- 不要切回旧 `E:/codex/weijia` 副本；不要重复登录、Python/PostgreSQL 迁移、图片替换和旧 Node/Blob 修复。

## 用户已确定的范围

使用 EdgeOne Pages + Python Cloud Functions + Neon PostgreSQL，不使用 CloudBase。登录页采用 A 方案和用户提供的人物图。用户在现有设置界面填写八家模型自己的 API；IMA 使用站点所有者凭据，管理员可按月更新。模型 Key、IMA 覆盖凭据、会话和批次进度只在服务端保存。

移动端当前可接受，本阶段只重点改善 PC。用户新增但明确要求稍后处理的需求：第一次运行前选择文章输出目录，同一台设备复用已授权目录，不要每批重复选择。

## 当前实现

- EdgeOne Python ASGI + PostgreSQL 登录、会话、CSRF、限流、模型设置、IMA 覆盖和幂等批次状态机仍保留；用户已确认上一版线上可以真实登录。
- PC 端在 861px 以上使用微软雅黑优先的独立排版层：辅助文字 12px、正文/表格 13–14px、卡片标题 16–18px；移动端原布局不变。
- 运行按钮只有在 `disabled` 时显示灰色；可运行时显示深蓝底白字。
- 顶部模型和 IMA 徽标已改为读取 `/api/settings`，与创作准备区、设置页和右侧状态舱使用同一配置状态，不再保留静态“未连接”。
- Excel 读取端和 Python 后端都会删除整行为空的格式行。包含 200 个格式行但只有少量真实任务的表格不再误触 100 行限制。
- API Key 设置交互未改。厂商适配已修正腾讯混元、MiniMax 中国开放平台和 Kimi 的官方域名，MiMo Bearer 鉴权，以及 MiniMax/Kimi/MiMo 的 token 字段；不自动重试外部生成请求。
- 默认目录保留混元 Hy3/Hy4、Qwen3.8、Seed 2.0、DeepSeek V4、MiMo V2.5；MiniMax 更新为 M2.7/M3，智谱更新为 GLM-5.3 Flash/5.3；Kimi 界面保留用户指定的 K2.7 Code/K3，并使用开放平台 `kimi-k2.7-code`/`kimi-k3` 请求 ID。
- `npm run test:python` 已改用跨平台 Node 启动器，在 Windows 不再因路径分隔符无法启动虚拟环境。

## 本阶段新鲜验证证据

- 已把 SaaS 运行时计划落到当前工作树：schema v2、租户/子账号、30 天订阅、积分台账与逐任务退款、站点级 IMA 加密缓存、批次模型快照、持久化文章文件、租约任务和独立 Python worker。
- `npm test`：20/20 通过。
- `npm run test:python`：58/58 通过。
- `npm run build`：成功生成最新 `assets/app.js`、PDF worker 和白名单 `dist`。
- `git diff --check`：无空白错误。
- TDD 覆盖新增运行按钮边界、模型锁定、artifact 下载、五任务积分预扣/退款、重复退款幂等、IMA 缓存命中/清代、租户权限与订阅过期、worker 租约恢复等路径。
- `geo-site/docs/deployment/geo-saas-runtime.md` 已补充 EdgeOne 变量、Neon pooled URL、schema v2、worker、缓存代际、积分订阅与二维码的现场验收步骤；未写入任何密钥。

## 当前三层状态

- 本地工作树：在原型 ce83602 上完成本轮真实数据库修复阶段并建立检查点；SaaS 整体仍未完成，不能据测试通过判定已线上可用。
- GitHub：远端 `master` 仍是上一版 Python/PostgreSQL 提交；本阶段尚未推送。
- EdgeOne：上一版已由用户确认可以登录；本阶段 PC/IMA/Excel/模型适配修复尚未部署。

## 仍需完成或现场确认

1. 先修复上方真实数据库与运行时缺陷、补齐端到端验收，再建立发布检查点并推送授权的 GitHub master。不要跳过此门槛。
2. 部署后检查 `/api/health`、登录、订阅/积分、artifact 下载和顶部 IMA 状态。没有读取或输出任何密钥值。
3. Mock 测试证明请求契约正确，但不能代替各厂商账号权限、余额和模型开通状态。线上已有模型密钥时，可通过“测试已保存模型”发起一次明确的小请求；其余厂商必须在各自 Key 配置后逐个测试，不能宣称未配置厂商已经真实成功。
4. 后续阶段实现文章输出目录选择与同设备复用；浏览器需要采用 File System Access API，并为不支持的浏览器提供逐篇下载退路。

## 重要限制

- 浏览器关闭后已完成的批次步骤仍持久化，但不会后台无限自动推进。
- 模型失败/超时不自动重发；只有用户明确恢复失败步骤才继续，避免重复计费。
- IMA 证据最多读取前六份完整原文；超长或不支持格式明确报错，不静默截断。
- `.local`、数据库连接串、密码、管理员口令、IMA 与模型 Key 不得进入 Git 或进度记录。
