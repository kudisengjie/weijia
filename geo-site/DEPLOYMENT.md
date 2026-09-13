# 零雪 GEO · EdgeOne + Python + PostgreSQL 部署

官网主站继续使用原项目。可运行的 GEO 子站部署 `kudisengjie/weijia` 仓库中的 `geo-site` 目录，不使用 CloudBase，也不再使用 EdgeOne Blob 保存登录或批次数据。

## 1. EdgeOne 项目配置

| 项目 | 值 |
| --- | --- |
| 发布分支 | `master` |
| 根目录 | `geo-site` |
| 框架 | Other / 自定义 |
| 安装命令 | `npm ci` |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| 构建 Node | 保持当前 22.17.1 |
| Python 函数入口 | `cloud-functions/api/[[default]].py` |
| Python 依赖 | `cloud-functions/requirements.txt` |

`edgeone.json` 已启用 Python Cloud Functions，并把最长运行时间设为 120 秒。公开的 `dist` 只有前端文件；Python 函数由 EdgeOne 单独识别和打包。

## 2. 创建 Neon PostgreSQL

1. 在 Neon 创建一个项目和数据库。
2. 在 Connect 页面选择 pooled connection，复制连接串。
3. 确认连接串以 `postgresql://` 或 `postgres://` 开头，包含数据库名，并带有 `sslmode=require`。
4. 不要把连接串写进 Git、截图或发到聊天；只保存到 EdgeOne 服务端环境变量 `DATABASE_URL`。

Python 后端第一次成功连接时会在事务锁内幂等创建数据表和 `pgcrypto` 扩展；不需要手工执行 SQL。数据库中保存稳定用户、7 天会话、加密模型 Key、加密 IMA 覆盖凭据、批次进度及防重复步骤记录。

## 3. 服务端环境变量

保留此前已经配置的 7 项，只新增第 8 项 `DATABASE_URL`。所有变量都必须是服务端变量，不能添加 `VITE_` 或 `PUBLIC_` 前缀。

| 变量名 | 用途 |
| --- | --- |
| `APP_ORIGIN` | 正式地址 `https://geo.lxue.xin`，不带末尾斜线 |
| `GEO_ACCOUNT` | 授权登录账号 |
| `GEO_PASSWORD_HASH` | 现有 scrypt 密码哈希，不是明文密码 |
| `GEO_MASTER_KEY` | 现有 64 位十六进制数据加密根密钥；不得重新生成 |
| `IMA_ADMIN_SECRET` | 管理员更新 IMA 凭据时使用的独立口令 |
| `IMA_OPENAPI_CLIENTID` | 站点所有者当前 IMA Client ID |
| `IMA_OPENAPI_APIKEY` | 站点所有者当前 IMA API Key |
| `DATABASE_URL` | Neon PostgreSQL pooled connection string，生产环境须启用 TLS |

开发电脑的原有私有值位于被 Git 忽略的 `geo-site/.local/edgeone-secrets.json`。只能在本机和 EdgeOne 后台之间复制，不能上传该文件。Windows 环境变量也不会自动同步到 EdgeOne。

禁止在生产环境设置 `GEO_LOCAL_DEV=1`；该变量只允许本地 HTTP 调试。

## 4. 部署和一次性验收

1. 新增 `DATABASE_URL` 后保存环境变量。
2. 重新部署生产分支 `master`，并核对部署记录使用的是目标提交；只刷新网页不会应用新变量。
3. 打开 `https://geo.lxue.xin/api/health`。成功响应应包含 `service: available`、`database: available`、`schemaVersion: 1`、`ready: true`，不会返回任何环境变量值。
4. 返回 `SETUP_REQUIRED` 表示变量名称或格式缺失；返回 `SERVER_ERROR` 时只查看这一条请求对应的 Python Cloud Functions 日志，重点确认 Neon 网络、TLS、数据库权限和 `pgcrypto` 扩展权限。
5. 健康检查通过后再登录。登录成功即证明密码哈希兼容、Cookie 会话写入 PostgreSQL 和会话回读均已落地。
6. 进入设置，保存一个模型 Key，刷新或重新登录后确认仍显示“已配置”，再由用户主动执行一次真实模型测试。
7. 最后用一行任务做真实小批次，确认暂停/继续、历史恢复和 MD 下载。

日志和截图必须遮住数据库连接串、密码哈希、根密钥、管理员口令及 IMA/模型凭据。

## 5. 每月更新 IMA

登录后进入“设置 → 共享 IMA 知识库 → 管理员更新”，填写独立管理员口令、新 Client ID、新 API Key 和未来到期日期。服务端先真实验证新凭据可以访问 `copilot` 知识库，成功后才加密写入 PostgreSQL；失败时保留旧值。数据库覆盖值优先于初始环境变量，因此正常轮换不需要修改 EdgeOne 变量或重新部署。

## 6. 使用与安全边界

- 同一授权账号的设置和历史现在跨登录保留；不同会话不再丢失最新进度。
- 每个批次在创建时固定所选模型。模型请求失败或超时不会自动重发，避免重复计费；超时步骤只能由用户明确恢复。
- 页面关闭后已完成的步骤仍在 PostgreSQL 中，但浏览器不会在后台无限触发后续步骤。
- 原生联网搜索未启用。模型目录是界面固定目录，实际调用权限取决于用户自己的厂商账户。
- IMA 最多读取检索排名前六份完整证据文档；超大或不支持的正文会明确报错，不会静默截断。
- 不使用 CloudBase。Neon、EdgeOne Functions、IMA 和各模型厂商仍受各自免费额度或套餐限制。

参考：[EdgeOne Python Functions](https://pages.edgeone.ai/document/python)、[EdgeOne 身份验证与 Neon 示例](https://pages.edgeone.ai/document/agents-authentication)、[edgeone.json](https://pages.edgeone.ai/document/edgeone-json)。
