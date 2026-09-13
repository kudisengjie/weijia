# GEO PC 端可读性与运行可靠性实施计划

> 设计依据：`docs/superpowers/specs/2026-09-13-geo-pc-runtime-reliability-design.md`

## 任务 1：锁定 Excel 空白行回归

- 新建 `geo-site/src/spreadsheet-rows.test.mjs`，覆盖格式化到 200 行但只有标题与少量任务行的工作表数据。
- 先运行该测试并确认失败。
- 新建 `geo-site/src/spreadsheet-rows.js` 导出纯函数，删除全空/全空白行。
- 在 `geo-site/src/app.js` 的 `readSpreadsheetRows()` 中使用该函数。
- 再运行测试并确认通过。

## 任务 2：统一连接状态

- 在 `geo-site/src/model-switch.test.mjs` 增加顶部状态节点与运行时更新断言，先确认失败。
- 给顶部模型和 IMA 状态添加独立数据属性。
- 扩展 `geo-site/src/runtime.js` 的 `renderConnections()`，从 `/api/settings` 同步这些状态。
- 确认现有设置表单和右侧状态舱行为不变。

## 任务 3：更新官方模型目录与请求适配

- 先修改 JavaScript/Python 的目录期望与厂商请求契约测试，确认旧实现失败。
- 同步更新 `geo-site/src/model-switch.js`、`geo-site/cloud-functions/geo_backend/models.py` 与 `geo-site/index.html`。
- 把 `geo-site/cloud-functions/geo_backend/providers.py` 改为按厂商声明接口、鉴权与 token 字段，保留无自动重试策略。
- 运行模型目录与 Python provider 测试。

## 任务 4：提升 PC 可读性

- 在前端测试中加入微软雅黑、桌面字号下限和运行按钮双状态断言，先确认失败。
- 更新 `geo-site/styles.css`：全局字体改为微软雅黑优先；增加 861px 以上桌面排版覆盖；补充运行按钮启用/禁用样式。
- 保留 860px 以下现有移动端布局规则。

## 任务 5：综合验证与交付

- 运行相关 Node 测试、相关 Python 测试，然后运行完整测试与 `npm run build`。
- 检查 `git diff --check`、`git status` 和生产目录，不重复已记录且代码未变化的旧验证。
- 更新 `docs/superpowers/checkpoints/ACTIVE-GEO-PROGRESS.md`，记录本阶段根因、验证边界与部署所需动作，不记录密钥。
- 建立本地 Git 检查点，推送到 GitHub `master`；明确区分“已推送”和“EdgeOne 已完成自动部署”。
