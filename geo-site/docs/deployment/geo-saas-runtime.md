# GEO SaaS 部署与验收接续

本说明对应当前开发工作树，不代表 GitHub 已推送或 EdgeOne 已部署。所有密码、API Key、主密钥和数据库连接串都只能放在服务端环境或密钥管理中，不得进入 Git、截图、日志或本文档。

## 已有 EdgeOne 配置保持不变

本阶段没有新增必须在 EdgeOne 填写的环境变量：

| 变量 | 用途 |
| --- | --- |
| APP_ORIGIN | 实际 HTTPS 官网来源，必须与浏览器请求一致 |
| GEO_ACCOUNT | 总账号 |
| GEO_PASSWORD_HASH | 现有 scrypt 格式的密码哈希 |
| GEO_MASTER_KEY | 现有 64 位十六进制加密主密钥，不要随意替换 |
| DATABASE_URL | Neon 提供的完整 PostgreSQL 连接串，保留 sslmode=require 等参数 |
| IMA_ADMIN_SECRET | 所有者更新 IMA 的管理口令 |
| IMA_OPENAPI_CLIENTID | 所有者 IMA Client ID，数据库未覆盖时使用 |
| IMA_OPENAPI_APIKEY | 所有者 IMA API Key，数据库未覆盖时使用 |

模型 API Key 仍由各用户在原设置界面填写。其密钥按账号加密存放在 PostgreSQL，退出登录不会删除。前端不会保存这些密钥。

部署构建仍使用项目根目录 geo-site、输出 dist、安装 npm ci、构建 npm run build。Python Cloud Functions 与静态输出分别打包。核对正式部署的 Git 提交号，不能仅凭 master 分支名确认已上线。

## 数据与缓存

启动迁移是幂等的，当前 schemaVersion 为 2；新增表和列由服务端初始化，不要手动删表修复环境。

IMA 检索、目录和原文缓存在同一个 PostgreSQL 数据库，由全站子账号共享，缓存正文加密。命中缓存不再请求 IMA；只有任务所需的目录、规则、问句证据会获取。企业上传资料、模型配置、批次和文章按用户隔离，普通成员不能调用总账号的缓存管理接口。

- 月度更新 IMA 凭据：设置 → 共享 IMA → 总账号更新；先验证新凭据，再保存，不清缓存。
- 主动清缓存：仅总账号可操作。增加缓存代数，新批次重新读取必要资料。
- 运行中批次固定创建时的缓存代数，不因清缓存或换月更换中途资料。旧代数据保留，不能直接删除正在使用的缓存。
- 当前缓存原文、模型密钥、文章文件已加密；批次 JSON 状态中的资料副本仍待加密收尾，发布前必须完成，不能宣称所有正文已经加密。

## 子账号、积分和有效期

总账号在“账号与积分管理”创建成员，默认 30 天；初始积分为 0。必须先在“选择要管理的账号”中确认目标，再发放/收回积分或保存有效期。普通成员可查看自己的余额、最近 100 条流水、有效期和已有微信联系二维码。官网不处理在线支付。

一个有效 Excel 任务行预扣 1 积分，空格式行不计分。同一行要求多篇文章时，该行全部文章完整保存后才算成功。五行中一行失败，最终只保留四分消耗；其余行继续执行，失败行会显示原因。取消、到期或执行器中断会对未完整输出的行退款；重复请求不重复退款。

服务端完整文件保存后，单纯下载网络失败不退款，可以重新下载。当前文件格式是 MD。首次运行前选择本机输出目录并记住路径，按用户要求留待后续阶段。

所有者创建成员、修改订阅、积分调整、IMA 更新与清代均记录管理审计，记录中不含密码或密钥。续期重复提交相同起止日期不新增订阅。管理接口校验目标用户归属。

## A：EdgeOne 短步骤执行

每个 /api/batches/{id}/run 请求最多执行一个阶段，保存序号、任务状态和文件后返回。HTTP 请求中断不代表整个批次丢失。

- 暂停：/pause。服务端记录暂停意图，当前调用完成并保存后停止；保留预扣和模型锁。
- 继续：/resume。恢复暂停批次，不再次预扣。
- 取消：/cancel。停止后续步骤，返还未完成积分；已发出的模型请求无法撤回，提供商仍可能计费。
- 模型配置：账户有未结束批次时禁止更改，即使当前查看的是历史已完成批次。
- 中断：不自动重发结果不明的模型调用。超过 150 秒的失效步骤会跳过、退款并继续其他任务。
- 到期：不再发送模型请求，取消剩余任务并退款，已有文件继续可读。

没有独立 Worker 时，关闭网页后不会自动执行剩余步骤；重新打开可继续。不要把短步骤 API 等同于常驻后台。

## B：独立 Python Worker

已实现并用真实 PostgreSQL 在本地验证命令行执行、租约和无浏览器输出。生产仍需一个可持续运行 Python 的主机/容器；当前没有确认部署目标，不能声称 Worker 已在生产运行。不要擅自开通付费主机。

在该主机部署同一 Git 提交、复用上表的服务端环境变量，尤其 DATABASE_URL 和 GEO_MASTER_KEY 必须与 EdgeOne 相同。Worker 不需要单独开放公网端口。

在 geo-site 目录安装依赖，并按实际系统执行：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r cloud-functions/requirements.txt
PYTHONPATH=cloud-functions .venv/bin/python -m geo_backend.worker --once
PYTHONPATH=cloud-functions .venv/bin/python -m geo_backend.worker --poll-seconds 2
```

Windows 已建虚拟环境时：

```powershell
$env:PYTHONPATH = (Resolve-Path './cloud-functions').Path
.venv/Scripts/python.exe -m geo_backend.worker --once
.venv/Scripts/python.exe -m geo_backend.worker --poll-seconds 2
```

--once 最多执行一个持久化步骤，不是执行整个批次。常驻模式处理后续待执行步骤，90 秒租约、心跳续租、令牌隔离过期 Worker；和浏览器共享同一批次步骤锁。进程异常由主机服务管理器重启，不启用“自动重试模型请求”。SIGINT/SIGTERM 等当前阶段保存后退出。

## 本地验收证据与剩余现场验收

已验证：

- 真实 PostgreSQL 的 33 项全量检查，以及其后新增账号边界的定向补测；60 项 Python 单元/接口测试，23 项 Node 测试。
- IMA 固定响应驱动完整流水线，两个账号使用各自模型 Key；第二位账号零 IMA 请求，文章实际写入 PostgreSQL。
- 本机真实浏览器：总账号登录、指定子账号发积分及续期、创建子账号、流水查看、暂停/继续、下载真实存储的 MD 文件、模型解锁；普通成员不可见管理入口，手机 390px 不横向溢出。
- 浏览器发现的登录页重置默认日期问题已修复。PC 下拉框和日期字段已补充尺寸检查。

这些验证只使用隔离数据库和固定上游响应，不证明任何厂商线上 Key 的权限或余额正常。

发布前剩余：

1. 完成批次正文副本加密及安全审查。
2. 保存发布检查点、推送授权的 GitHub master，再确认 EdgeOne 部署了完全相同的提交。
3. 线上检查 /api/health、真实登录、账户隔离、余额、IMA 配置状态和文章下载。
4. 经确认后仅用一个测试任务验证真实 IMA 与已配置模型，核对实际调用次数和积分。不要批量尝试八家模型。
5. 确认独立 Worker 的实际承载主机，再执行 B 方案生产部署。

本机浏览器夹具位于 tests_postgres/serve_ui_fixture.py；仅监听 127.0.0.1:8769，连接硬编码本机隔离 PostgreSQL（端口 55483），使用随机临时 schema，正常退出后清理。依赖 tests_postgres/requirements.txt 与已安装的 Playwright。截图和下载文件位于忽略的 output/playwright/saas-runtime，不进入 Git。
