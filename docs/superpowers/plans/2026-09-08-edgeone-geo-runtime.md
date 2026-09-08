# EdgeOne GEO 实施计划

**Goal:** 完成已批准的 A 登录页、用户自定义模型 API、管理员 IMA 更新与真实 GEO 批次。

**Architecture:** 原有静态前端升级，同域 Node Cloud Functions，Blob 私有持久化；每个请求执行一个可恢复阶段。

**Tech Stack:** ES Modules、Node.js 20、Web Request/Response、EdgeOne Blob、现有 SheetJS/Mammoth/PDF.js。

按当前任务内顺序执行，沿用已存在的隔离 worktree，避免重复审批。

- [x] `server/security.mjs`、`server/storage.mjs`：密码哈希、Cookie/CSRF、加密及条件写锁。测试覆盖匿名拒绝、加解密隔离、重复执行领取。
- [x] `server/credentials.mjs`、`server/providers.mjs`：各模型 Key 保存/删除/测试；默认官方端点；IMA 管理员验证与先测后换。严禁回显或记录凭据。
- [x] `server/ima.mjs`、`server/batches.mjs`：规则来源、完整原文、品牌绑定、批次锁定、分阶段生成与审核、最终下载；失败要求用户显式重试。
- [x] `server/router.mjs` 与 `cloud-functions/api/[[path]].js`：同源私有 API、认证、设置、批次与下载路由。
- [x] `src/runtime.js`、`index.html`、`styles.css`：A 登录布局、提供商 Key 表单、管理员 IMA 轮换、批次运行/继续/结果；复用上传解析并保留完整文本。
- [x] `scripts/build.mjs`、`scripts/dev.mjs`、`scripts/setup.mjs`、`edgeone.json`：仅公开产物部署、本地测试服务、忽略目录中生成初始哈希与服务端根密钥，不把真实值写入 Git。
- [x] 修复后的最终 21 项测试与构建通过；IMA 一次真实只读请求成功。
- [x] 桌面/手机浏览器验收与提交结果不确定时的恢复补测通过。
- [x] 集中审查和对应 3 个重要缺陷修复完成；Node 20 函数入口构建通过。
- [x] 建立本地 Git 检查点及固定恢复入口；代码发布状态由恢复命令比较 HEAD/origin/master，避免重复推送。
- [ ] EdgeOne 控制台配置服务端环境变量与 Blob，并完成真实线上验收（缺少当前服务授权）。

最新状态以 `../checkpoints/ACTIVE-GEO-PROGRESS.md` 为准。恢复命令：`node geo-site/scripts/progress.mjs`（仓库根目录）。验证命令：`npm test`、`npm run build`（geo-site 目录）。私有配置已经初始化，勿重建。运行测试的 Key 均为明确标注的测试值，真实连接检查采用独立脚本，输出仅状态。
