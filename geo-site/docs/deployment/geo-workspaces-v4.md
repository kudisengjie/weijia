# 五工作区服务端 v4（尚未整体发布）

持久化 API 和正式前端五工作区已在本机真实浏览器/隔离 PG 联调。独立 Python Worker 五路调度也已完成本机无浏览器验证：四篇完整 MD 落库，第五路故障仅退一分，各模型步骤没有重复请求。上游为固定测试响应，不是生产模型实测。

生产 Worker 承载主机尚未确认，也尚未部署；当前网页保留“关闭页面可能暂停后续生成”的准确提示。不能以 health=4 认为关页五并行已上线。Worker 启动命令和发布顺序见 [部署与验收接续](geo-saas-runtime.md#b独立-python-worker)。

启动 Python API 时自动添加 workspaces 表并标记 schemaVersion=4。沿用 DATABASE_URL 与 GEO_MASTER_KEY；无新增环境变量，不更换现有加密密钥。升级前停止旧版在途任务；不要并存使用不了解工作区名额的旧 API/worker。没有删除历史批次、文章或缓存。

新 API 均要求本人服务器会话，POST 还要求 Origin 和 CSRF：

| 路径 | 请求/作用 |
|---|---|
| GET /api/workspaces | 本人摘要、occupied、limit=5，不返回草稿正文或 Key |
| POST /api/workspaces | `{requestId}`，幂等占用草稿名额 |
| GET /api/workspaces/{id} | 本人加密草稿及对应批次详情 |
| POST /api/workspaces/{id}/save | `{version,draft}`，旧版本拒绝覆盖 |
| POST /api/workspaces/{id}/start | `{version}`，原子创建批次、积分预扣与固定模型快照 |
| POST /api/workspaces/{id}/archive | `{version}`，仅关闭未启动草稿；运行中需取消批次并按行退款 |

draft 只允许 title/taskFileName/sheetName/rows/companies/model；不接受 API Key、角色或其他账号 ID。模型引用已有厂商密钥，原密钥录入方式不变。资料最大 4MB，启动仍执行原 Excel 有效行/篇数限制。

跨标签页更新返回 WORKSPACE_VERSION_CONFLICT 时重新读取并提示用户，禁止自动覆盖。WORKSPACE_LIMIT_REACHED 时显示占用五个名额，关闭草稿/完成或取消批次释放。已启动工作区不可编辑；重复 start 返回同 batch，不再预扣。过期可读文件及关闭未启动草稿，不可新建/保存/启动。

本地证据来自真实 PostgreSQL、ASGI 与固定模型响应；不代表 EdgeOne 已部署或生产模型 Key 已验证。常驻 worker 主机必须明确后才能验收关页持续执行。

工作区名额是每个账号最多五个（草稿及未结束批次合计），不是每份 Excel 限制五行。Worker 的 `--concurrency 5` 是单进程总执行槽上限，不是全站每账号分别配五个进程。首轮只部署一个 Worker 实例；增加实例或容量前须另行验证，不直接开启自动扩容。网页与 Worker 共享步骤锁；遇到已认领的步骤不会重复发送模型请求，目前可手动刷新读取后台进度。
