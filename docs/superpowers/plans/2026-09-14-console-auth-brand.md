# A+B 商业工作台：认证与品牌接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 用户要求内联执行。

**Goal:** 固定已批准的 A+B 方向，先解除登录入口自动跳转和旧响应竞态，换用用户指定品牌图。

**Architecture:** 登录入口要求主动提交密码；只有当前已登录标签页的刷新才向服务端申请恢复，前端标记不是认证凭据。用认证代数丢弃旧请求；服务端验证密码后轮换当前浏览器会话，绝对有效期缩为 8 小时。品牌图直接复用原文件，不重绘。

**Tech Stack:** 原生 JS、FastAPI、PostgreSQL、现有无头 Edge。

---

已批准：A 首页总览 + B 工作区详情、目录设置、owner 管理中心、五个独立工作区；保留冰蓝与微软雅黑。新增指定图标位于 E:/图片/零雪LxueAI/LxueAI_透明背景1.png。当前计划是第一可独立验收阶段，后续界面与并行各自记录实现计划及测试，不能将本阶段声称为整体交付。

## Task 1：认证入口与异步响应隔离

Files: 新建 geo-site/src/auth-flow.js、auth-flow.test.mjs；修改 geo-site/src/runtime.js、app.js、index.html；新增 scripts/check-login-flow.mjs。

- [ ] 写失败用例：`assert.equal(shouldRestoreSession({navigationType:'navigate',tabAuthenticated:true}),false)`；`reload` 且有标记为 true，`#login` 为 false；不同代数响应不可接受；`authenticated:false`、缺少 csrf、过期响应不可进入。
- [ ] 执行 `node --test src/auth-flow.test.mjs`，确认缺失接口/断言失败。
- [ ] 实现 `createAuthFlow()`（begin、invalidate、isCurrent、accept）与 `shouldRestoreSession()`；API 返回后先核对代数再处理。入口只在 reload + tab marker 的情况下读取 auth/session。登录/退出开始即更换代数；退出、401 清除私有上传、表单、文章、成员信息。
- [ ] 浏览器覆盖：旧 Cookie 的新导航不自动登录；手动登录成功；同页刷新恢复；无效成功 JSON 不进入；旧 settings 401 在新登录后到达不清掉新会话；退出后旧成功响应不得重开工作区。

## Task 2：后端会话轮换与短有效期

Files: 修改 geo-site/cloud-functions/geo_backend/security.py、auth.py、app.py、repository.py；补充 tests_py/test_auth.py、test_app_contract.py 与 tests_postgres 专项。

- [ ] 写失败用例：`SESSION_TTL == timedelta(hours=8)`；已成功登录后再次输入正确密码，旧 cookie 返回 401；错误密码不能撤销旧会话；空密码必须失败。
- [ ] 执行 `.venv/Scripts/python.exe -m unittest tests_py.test_auth tests_py.test_app_contract`，只记录新失败项。
- [ ] `login(account,password,previous_cookie=None)` 在密码成功之后撤销旧令牌；路由传入当前 Cookie；`max_age=int(SESSION_TTL.total_seconds())`。SQL 读取添加 `created_at > NOW() - INTERVAL '8 hours'`，返回的 expiresAt 不晚于 created_at + 8h。
- [ ] 定向复测并用隔离 PostgreSQL 验证旧令牌撤销、8h 边界。保留 HttpOnly/Secure/SameSite、Origin、CSRF、失败限流；不变更任何密钥。

## Task 3：品牌图与检查点

Files: geo-site/assets/lxue-brand-logo.png、geo-site/index.html、styles.css；设计原型同步引用正式资产。

- [ ] 浏览器失败检查左上角 `.geo-brand__mark img` 存在、decode 成功、展示约 34–40px，不影响文字。
- [ ] 原图 Copy-Item 到新的资产路径（保持文件内容不变）；替换雪花字符，alt 留空避免重复朗读邻近品牌名；object-fit:contain，不新增背景和放大留白。
- [ ] `npm run build` 后定向真实 Edge 检查登录和品牌；查看截图；`git diff --check`。
- [ ] 更新 ACTIVE-GEO-PROGRESS.md / GEO-RESUME.md 并建立本地 Git 检查点。仅本地保存，生产部署和真实模型验证单独列明。

## 后续阶段边界

目录设置、A+B 正式视图和五工作区按独立计划推进。五路运行必须前后端限制、独立上传状态、模型快照、幂等积分和文章归属全部验证；生产常驻 worker 承载需要明确服务器/平台授权，不能把本地并行或浏览器循环称为关页后生产持续运行。30 分钟服务端交互闲置超时与敏感操作二次验证尚不包含在本阶段，不能宣称已有。
