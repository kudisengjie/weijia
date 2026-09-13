# 零雪 GEO 当前检查点

更新时间：2026-09-13。本文件只记录可复核的实现、验证和明确未完成项；本地、GitHub、EdgeOne 三层状态分开记录，不把“已保存”“已推送”“已部署”混为一谈。

## 从这里接续

- 当前工作树：`E:/codex/weijia/.worktrees/static-geo-model-catalog`
- 当前分支：`feat/static-geo-model-catalog`
- 发布目标：`kudisengjie/weijia` 的 `master`，用户已授权推送。
- GEO 子站目录：`geo-site`
- 不要切回旧 `E:/codex/weijia` 副本，不要重复图片替换、静态模型目录、排版和旧 Node/Blob 修复。

## 用户已确定的范围

使用 EdgeOne Pages，不使用 CloudBase。登录页继续采用 A 方案和用户提供的透明人物图；登录后进入可运行 GEO 工作台。用户填写八家模型自己的 API（不包含 Agnes），每个批次固定创建时所选模型。IMA 使用站点所有者凭据，管理员可按月更新；模型 Key、IMA 覆盖凭据、会话和批次进度只在服务端保存。

## 当前实现

- `geo-site/cloud-functions/api/[[default]].py`：EdgeOne Python ASGI 入口；入口显式补入 `cloud-functions` 路径，保证共享后端包可导入。
- `geo-site/cloud-functions/geo_backend/`：FastAPI 路由、Node scrypt 兼容密码验证、HttpOnly/Secure/SameSite 会话、CSRF、登录限流、PostgreSQL 仓储、幂等批次状态机、IMA 和八家模型适配器。
- `geo-site/cloud-functions/schema.py`：Neon PostgreSQL/pgcrypto 表结构，包含稳定用户、会话、模型设置、IMA 覆盖、批次 JSONB 状态和 `(batch_id, seq)` 防重复领取记录；首次连接在事务级 advisory lock 下幂等初始化。
- `geo-site/cloud-functions/requirements.txt`：FastAPI、httpx、psycopg、pydantic、pypdf、python-docx。
- `geo-site/edgeone.json`：仅启用 Python Cloud Functions，最长运行 120 秒；旧 Node/Blob 入口和依赖已删除。
- `geo-site/src/runtime.js`：登录成功先展示工作台，再加载设置和历史；加载失败不回到登录页，也不会重复读取；诊断文案指向 Python Cloud Functions/PostgreSQL。
- `geo-site/DEPLOYMENT.md`：唯一部署路径为 EdgeOne + Neon，说明现有 7 个变量保持不变，只增加 `DATABASE_URL`，以及 `/api/health` 验收方式。
- `geo-site/scripts/setup.mjs`、`scripts/dev.mjs`、`scripts/smoke_ima.py`：不输出密钥；初始化脚本从 `GEO_ACCOUNT` 环境读取账号，不把账号硬编码进仓库。

## 本次新鲜验证证据

- `.venv/Scripts/python.exe -m unittest discover -s tests_py -v`：32/32 通过。
- `node --test src/runtime-auth.test.mjs src/model-switch.test.mjs`：12/12 通过。
- `npm run build`：成功生成 `assets/app.js`、PDF worker 和白名单 `dist`。
- `git diff --check`：无空白错误。
- 回归边界已先复现再修复：超大登录 body 返回 413；恶意 IMA 端口返回安全的 422；HTTP 传输层断开只报告一次错误，不自动重试。
- 已运行 `npm install` 更新 `package-lock.json`；旧 `@edgeone/pages-blob`、`pdfjs-server` 和 Node 服务端已从依赖/源码中移除。

## 还不能声称完成的事项

1. 当前提交尚未完成 Git 检查点和推送；完成最后的状态/秘密扫描后再提交并推送到授权的 `master`。
2. 本机没有可用 Neon `DATABASE_URL`，因此没有冒充完成线上 PostgreSQL、EdgeOne `/api/health`、真实登录、真实模型或真实批次验收。用户在 EdgeOne 新增 `DATABASE_URL` 后必须重新部署 `master`，再按 `DEPLOYMENT.md` 顺序验收。
3. IMA 真实只读测试曾在旧运行链路通过，但 Python/Neon 新线上链路尚未宣称真实通过；线上验收时只做一次明确的小批次和一次用户授权的真实模型测试。

## EdgeOne 后台接续动作

保留已有 `APP_ORIGIN`、`GEO_ACCOUNT`、`GEO_PASSWORD_HASH`、`GEO_MASTER_KEY`、`IMA_ADMIN_SECRET`、`IMA_OPENAPI_CLIENTID`、`IMA_OPENAPI_APIKEY` 的值，不重新生成；只新增 Neon pooled connection string 为 `DATABASE_URL`，使用 `sslmode=require`。保存后重新部署 `master`，先访问 `/api/health`，再登录。任何截图都遮盖连接串、哈希、根密钥、管理员口令、IMA 和模型 Key。

## 重要限制

- 原生联网搜索没有启用。
- 浏览器关闭后已完成的批次步骤仍持久化，但不会后台无限自动推进。
- 模型失败/超时不自动重发；只有用户明确恢复超时步骤才会继续，避免重复计费。
- IMA 证据最多读取前六份完整原文；超长或不支持格式明确报错，不静默截断。
