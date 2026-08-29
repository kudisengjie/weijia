# 官网静态 GEO 八厂商模型目录设计

## 目标

把官网 `geo-site` 的 Agnes / DeepSeek 两项下拉框升级为八家厂商的静态模型目录。访客可以先选厂商，再在统一的 Flash / Pro 两档之间切换；页面只同步展示状态，不连接 API、不保存选择、不运行生成任务。

## 明确边界

- 厂商固定为腾讯混元、通义千问、豆包、DeepSeek、MiniMax、智谱、Kimi、MiMo。
- 不保留 Agnes。
- 默认选择 DeepSeek + Flash。
- Flash / Pro 是官网统一的交互层级；卡片下方必须展示厂商真实模型或真实模式名称，不伪造 API ID。
- 选择只存在于当前页面内存，刷新后恢复 DeepSeek Flash。
- `#run-task` 始终禁用，API 请求计数始终为 0。
- 不增加密钥输入、请求地址、`fetch`、WebSocket、浏览器存储或后端接口。

## 模型映射

| 厂商 | Flash 档真实映射 | Pro 档真实映射 |
| --- | --- | --- |
| 腾讯混元 | Hy3 / `no_think` | Hy3 / `think_high` |
| 通义千问 | `qwen3.8-flash` | `qwen3.8-max` |
| 豆包 | Doubao-Seed-2.1-Turbo | Doubao-Seed-2.1-Pro |
| DeepSeek | `deepseek-v4-flash` | `deepseek-v4-pro` |
| MiniMax | MiniMax-M3 / `thinking disabled` | MiniMax-M3 / `thinking enabled` |
| 智谱 | GLM-5.2 / `reasoning low` | GLM-5.2 / `reasoning max` |
| Kimi | Kimi K3 / `reasoning low` | Kimi K3 / `reasoning max` |
| MiMo | `mimo-v2-flash` | `mimo-v2.5-pro` |

## 交互设计

设置页使用两个原生 `fieldset`：

1. 厂商选择区使用八张带 Logo 的单选卡。桌面端四列两行，窄屏两列四行。
2. 模式选择区使用 Flash / Pro 两段式单选开关。

原生 radio 保留键盘和辅助技术语义，视觉层由相邻卡片表面承担。选中态使用现有冰蓝描边、浅蓝底和小型状态点；焦点态使用清晰外轮廓。Logo 只作为厂商识别，不作为按钮唯一文本。

选择变化后统一同步以下区域：

- 工作区右上角模型徽章；
- 静态前置检查中的所选模型；
- 设置页当前模型和真实映射；
- 状态舱的当前模型与未连接服务标签。

## 视觉方向

保持现有零雪冰蓝玻璃卡片体系，不调整页面主布局、字号体系和 IP 状态舱。新增目录的唯一视觉重点是八张 Logo 卡片组成的“模型样本柜”；其余元素保持安静，避免整页重设计。

## 数据结构

`geo-site/src/model-switch.js` 保存只读目录：厂商元数据、Logo 路径和两档展示数据。`getModelPresentation(provider, tier)` 负责规范化非法输入并返回扁平展示对象。`src/app.js` 只读取 radio 值并刷新 DOM，不承担模型目录判断。

## 验证标准

- 自动化测试先失败再通过，覆盖默认值、八厂商、每家两档、非法值回退和关键映射。
- HTML 中不存在 Agnes，存在八个厂商 radio 和两个模式 radio。
- Logo 文件全部存在，构建成功。
- 浏览器桌面端与移动端均可完成切换，无横向溢出，键盘焦点可见。
- 生成按钮禁用，源码不包含任何模型网络传输 API。

