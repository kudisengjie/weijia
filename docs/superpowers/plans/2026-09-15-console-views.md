# A+B 正式视图与目录设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans，按用户要求内联执行。

**Goal:** 将已批准 A 总览 + B 当前任务详情接入真实批次/文章数据，恢复紧凑排版，拆开个人设置与 owner 管理。

**Architecture:** 保留模型、计费和生成接口；新 console-view.js 只组织视图和目录，runtime.js 提供服务端批次并执行动作。复用原表单节点和 ID，避免复制表单造成事件/凭据混用。PC 默认 12px，按钮/正文不超过 14px，页标题 22px；手机保持单列和可滚动页签。

**Tech Stack:** 原生 DOM / CSS、现有 Python API、Edge 浏览器。

---

执行记录（2026-09-15）：Task 1–3 已完成，材料只读缺口经浏览器红/绿补测；实际 Edge + FastAPI + 隔离 PostgreSQL 的目录表单提交、权限 403、暂停/继续与文件下载通过。上游使用固定响应，未部署生产。截图已查看；登录结构回归、构建与差异检查通过。具体证据见 ACTIVE-GEO-PROGRESS.md 阶段八；五工作区是下一阶段，不包含在本页“完成”中。

## Task 1：正式页面浏览器验收先失败

Files: 新建 geo-site/scripts/check-console-layout.mjs。

- [ ] 使用正式 index.html / styles.css / assets/app.js，仅模型及 API 数据由固定路由响应，不接触生产。
- [ ] 登录后断言 `data-view-panel=overview` 可见、Logo 加载；“个人设置”只显示“模型与 API”目录内容；切换“积分与有效期”“登录与安全”分别显示对应页。
- [ ] owner 可进独立管理中心，切换子账号/积分/续期/IMA/缓存目录；member 看不到入口且程序直接 changeView('admin') 不能进入。
- [ ] A 真实历史响应显示批次行，点击进入 B 并显示批次模型/进度/文件；资料/进度/文章切换独立显示内容，下载使用原 artifact 接口。
- [ ] 1440/1280/1920/390px 无横向页面溢出、PC 正文 12px、标题 22px；输入和按钮键盘焦点可见；保存截图并查看。

## Task 2：目录与任务视图接入

Files: 新建 geo-site/src/console-view.js；修改 geo-site/src/app.js、runtime.js、index.html。

- [ ] `initializeConsole({changeView})` 在 runtime 绑定表单事件前执行。把 `.geo-model-setting` 和模型凭据 section 移至个人 settings/models；account-service 移至 settings/billing；新增 security 说明页与 contact 微信节点。
- [ ] owner 页通过目录移动原 tenant-admin 表单和 ima-admin，不复制密码字段。`setOwner(role==='owner')` 同时控制导航入口、当前视图和所有管理页面；服务端 require_owner 保持。
- [ ] A 页面 `renderOverview(batches,open)` 用 textContent 绘制任务表、状态/文章数量/按钮，空状态引导新建；服务不可用给可重试提示而不是假数据。
- [ ] B 页面将现有上传表单保留为“资料与任务”；batch-progress 移至“运行进度”；文章按钮列表移至“文章文件”，当前已启动任务显示快照模型并锁定编辑。
- [ ] 左下角按钮进入新建页；当前已有在途批次时遵循真实后端限制，不误清未保存资料。五并行属于单独执行阶段，不把页签当成并行完成。

## Task 3：紧凑冰蓝布局

Files: geo-site/styles.css、index.html。

- [ ] PC 左侧 180px 主导航；右侧状态舱仅在详情显示且缩为 220px；人物缩为 64px。A 与设置用全宽主区。目录 168px + 内容。
- [ ] 用 `.geo-shell` 范围的 CSS token 定义正文 12/辅助 11/标题 14/页标题 22；替换此前 min-width:861px 的大字号块，不叠加全局 zoom 或强制正文不换行。
- [ ] PC 表格 12px，行高与 padding 8–10px；API 状态小卡并排，长文本可换行/水平表格滚动，不裁内容。移动端目录横向滚动与表单单列。
- [ ] 构建后执行新增浏览器脚本，修复实际溢出并看图；仅增量回归登录页面，因为页面结构变了。
- [ ] 保存本地 Git 检查点，更新恢复入口。五工作区、worker 生产配置、线上真实模型验收继续分开列明。
