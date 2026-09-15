# 五工作区持久化与原子启动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans，按用户要求内联执行。

**Goal:** 给后续五路工作台提供真实的加密草稿、跨设备五名额与事务启动 API。

**Architecture:** `workspaces` 保存账号隔离的加密草稿，以账号行锁分配名额；运行批次沿用现有 jobs、模型快照、缓存与积分事务。草稿 version 乐观锁阻止旧标签页覆盖，开始后不再允许编辑。旧 `/batches` 入口保留兼容，但必须计入同一名额，不能绕过限制。

**Tech Stack:** FastAPI、PostgreSQL/pgcrypto、现有 Python 测试。

此计划是独立服务端阶段，不包含前端五页签/常驻 Worker 并行；这两项仍须实施并验收，不能将以下 API 成功称为完整五并行上线。无需新密钥，数据库增量升级到 schema v4。

执行记录（2026-09-15）：Task 1–3 服务端代码与测试已完成。新增 workspace_repository.py 分离持久化职责。8 项新 PG 测试、16 项 schema/Batch/API、3 项旧迁移/默认工厂/幂等创建定向回归通过。补充五路真实数据库执行，一失败/四文件/仅一积分退款/归属校验通过；模型为固定响应。归档未启动草稿允许在过期后执行，释放名额，不启动模型或改积分。具体证据见检查点阶段九。前端和常驻 worker 尚未完成。

## Task 1：真实数据库失败用例

Files: `geo-site/tests_postgres/test_workspaces.py`。

- [ ] 复用 `PostgresRuntimeTests` 的临时 schema/账号初始化，独立 TestCase，不继承重复运行旧测试。
- [ ] 同账号八个线程各自独立 PG connection 同时 create：`assertEqual(5, len(successes))`，三个 `WORKSPACE_LIMIT_REACHED`。满额重复同 requestId 返回原 ID，不额外占位；其他账号仍可创建。
- [ ] save/get 中文正文往返、数据库仅 BYTEA、错账号 404；version=0 首次成功，再以 0 保存返回 `WORKSPACE_VERSION_CONFLICT`；已开始保存返回 `WORKSPACE_LOCKED`。
- [ ] 五草稿分别用两个已配置厂商启动，余额从 10 变 5；重复 start 余额不变、同 batchId；快照固定，跨账号没有权限。取消一个批次只返还对应一分并释放一个名额。
- [ ] 无积分的启动：batch/job/snapshot 均不残留，草稿继续可编辑；错误版本或未配置模型也不扣分。
- [ ] 登录后经真实 ASGI 请求新端点；没有会话/CSRF 拒绝，非法请求结构不回显正文。GET 可读取自己历史，过期不得新建/编辑/启动。

Run: `.venv/Scripts/python.exe -m unittest discover -s tests_postgres -p test_workspaces.py -v`；首次应因新服务不存在失败。

## Task 2：数据库与服务实现

Files: 新建 `geo-site/cloud-functions/geo_backend/workspaces.py`；修改 `schema.py`、`database.py`、`repository.py`、`batches.py`。

- [ ] schema v4 新表：`id CHAR(32) PRIMARY KEY, user_id UUID, tenant_id UUID, request_hash CHAR(64), state_cipher BYTEA NOT NULL, version INT DEFAULT 0, status VARCHAR(16), batch_id CHAR(32) UNIQUE, created_at/updated_at`，唯一 `(user_id, request_hash)`，status 只允许 draft/started/archived。
- [ ] `WorkspaceService.create(request_id,user_id)`：事务 + `lock_user` → 幂等查询 → `count_open_workspaces` 小于五 → 固定 user/workspace/tenant 加密 envelope → 插入。计数为 draft + 全部未结束 batches，不重复计 started 工作区。
- [ ] `get(workspace_id,user_id)` / `list(user_id)`：SQL 过滤账号和租户，解密校验 envelope；列表只出标题、模型、版本与 batch summary，GET 本人详情出 draft。最多返回最近 500 个，活跃名额查询不设 500 截断。
- [ ] `save(id,user_id,version,draft)`：只接收 title/taskFileName/sheetName/rows/companies/model；字符串、行列数与 4MB 限额校验，模型用现有 `model_selection` 白名单，禁止传入 API Key。行锁内校验 draft 状态和 version，再加密更新 version+1。
- [ ] `start(id,user_id,version,expires_at)`：账号锁内读取草稿；已启动返回同工作区；不变草稿 version 才可开始。调用可信内部 `BatchService.create(..., workspace_id=id)`；批次从数据库草稿选模型和 requestId，不接受客户端替换。创建批次、预扣、job、模型快照、绑定 workspace 在同一事务提交。
- [ ] `archive(id,user_id,version)` 只归档未启动草稿；运行任务必须使用原取消/退款接口，不能从关闭草稿绕过结算。
- [ ] 旧 `/batches` 调用仍遵循单活动批次规则，额外检查草稿+活动批次上限；可信 workspace 分支必须检查所有权、status 与容量，不通过客户端字段绕过限制。

## Task 3：API、增量验收与检查点

Files: 修改 `geo-site/cloud-functions/geo_backend/app.py`、`tests_py/test_schema.py`、`tests_postgres/test_runtime_integration.py` 的版本断言；进度文档。

- [ ] 新增严格 Pydantic 请求：create `{requestId}`；save `{version,draft}`；start/archive `{version}`。路由 `/workspaces`, `/workspaces/{id}`, `/workspaces/{id}/save|start|archive`；授权复用 authentication/tenant_context，写入要求有效订阅和 CSRF。
- [ ] JSON 仅工作区 save 放宽至现有 BATCH_JSON_LIMIT，其余不扩大；响应 no-store，异常不返回秘密。
- [ ] `database.ensure_schema` 成功创建新表后写版本 4；运行最新迁移用例及 schema 单元测试，确认 v1→v4、重复升级不丢已加密文章。
- [ ] 执行新增 PG 测试、受影响 Batch/API 回归及差异审查；更新 ACTIVE-GEO-PROGRESS/GEO-RESUME，保存本地 Git 检查点。前端和 worker 明确继续列为未完成，不推送未经整体验收的五并行。
