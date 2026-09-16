# 零雪 GEO：GLM 智谱开发交接与实施方案

> **For agentic workers:** 使用 `executing-plans` 按本文件分阶段内联执行。用户曾明确要求内联执行，不默认分派子代理。所有 `[ ]` 都是尚未完成的开发/验收任务，不是完成声明。

**Goal:** 在现有可登录、五独立工作区的 GEO SaaS 上，完善本地文章交付、在线正文清理、按完整交付结算积分，以及新建任务与导航的流畅体验。

**Architecture:** 保留 EdgeOne 静态前端 + Python FastAPI Cloud Functions + Neon PostgreSQL。新增浏览器目录授权与交付模块，采用“服务器临时加密保存 → 用户电脑写入并校验 → 服务端确认 → 清除在线正文”的链路；账号、积分、模型密钥、共享 IMA 缓存和必要交付元数据仍保留在数据库。

**Tech Stack:** 原生 JavaScript ES modules、HTML/CSS、esbuild、Python/FastAPI、psycopg、PostgreSQL/pgcrypto、浏览器 File System Access API/IndexedDB，现有 Node 内置 test runner 与 Python unittest、真实 PostgreSQL 和 Edge 浏览器夹具。

**文档日期：** 2026-09-16。**性质：** 当前代码交接 + 后续设计建议 + 实施任务书；不是新功能已经实现的报告。用户已选择“允许文章临时加密中转，本地保存成功后清除在线正文”。下文新增状态、接口及 schema v5 为建议设计，当前发布代码没有这些能力。

---

## 1. 必须先确认的项目根目录与 GitHub 位置

### 1.1 本机目录

| 用途 | 完整路径 |
| --- | --- |
| **当前开发项目根目录，GLM 应打开这里** | `E:\codex\weijia\.worktrees\static-geo-model-catalog` |
| GEO 应用目录；npm 命令在这里执行 | `E:\codex\weijia\.worktrees\static-geo-model-catalog\geo-site` |
| Python 后端包 | `E:\codex\weijia\.worktrees\static-geo-model-catalog\geo-site\cloud-functions\geo_backend` |
| EdgeOne Python 入口 | `E:\codex\weijia\.worktrees\static-geo-model-catalog\geo-site\cloud-functions\api\[[default]].py` |
| 最先读取的恢复入口 | `E:\codex\GEO-RESUME.md` |
| 当前项目进度记录 | `E:\codex\weijia\.worktrees\static-geo-model-catalog\docs\superpowers\checkpoints\ACTIVE-GEO-PROGRESS.md` |
| 本交接文件 | `E:\codex\weijia\.worktrees\static-geo-model-catalog\docs\superpowers\plans\2026-09-16-glm-development-handoff.md` |

**不要直接在 `E:\codex\weijia` 的旧 master 工作副本接着改。** 当前目录是 Git worktree，`.git` 可以是指向公共 Git 元数据的文件；不要复制、重建或删除它。

### 1.2 Git 与 GitHub

| 项目 | 已核实内容 |
| --- | --- |
| GitHub 仓库 | https://github.com/kudisengjie/weijia |
| origin URL | https://github.com/kudisengjie/weijia.git |
| 当前本地开发分支 | `feat/static-geo-model-catalog` |
| GitHub 生产发布分支 | `master` |
| GitHub master 页面 | https://github.com/kudisengjie/weijia/tree/master |
| GitHub 上 GEO 应用目录 | https://github.com/kudisengjie/weijia/tree/master/geo-site |
| 本次核实的生产代码基线 | `e12d4244d51db8b408d51d6daf7af473b212dab9` |
| 基线提交页面 | https://github.com/kudisengjie/weijia/commit/e12d4244d51db8b408d51d6daf7af473b212dab9 |

2026-09-16 实际执行 `git ls-remote --heads origin master feat/static-geo-model-catalog`，只返回上述 SHA 的 `refs/heads/master`。**远端没有同名 `feat/static-geo-model-catalog` 分支**，它目前是本地开发分支，不要编造对应 GitHub 分支链接。

此前的发布是将本地功能分支的提交正常快进推到远端 master。GLM 可以继续在当前本地分支开发；是否建立远端功能分支或发布 master，应按下一次用户授权执行。不要把推送功能分支误认为 EdgeOne 生产发布。

编写本文前业务工作树干净，HEAD 与远端 master 均为 e12d424。本次仅新增交接文档、更新进度并建立本地文档检查点；文档检查点 SHA 以 `git log -1` 和恢复入口为准，**不代表新增业务功能，也没有自动推送**。

如果 GLM 在这台电脑的编辑器中接手，可直接读取本文件；如果 GLM 只能读取 GitHub，必须将本文件作为附件/文本交给它，或另行授权推送文档分支。本地保存的交接文档不会自动出现在 GitHub master。

### 1.3 GLM 接手后的第一组命令：只读

```powershell
Get-Content -LiteralPath 'E:/codex/GEO-RESUME.md' -Raw
Set-Location -LiteralPath 'E:/codex/weijia/.worktrees/static-geo-model-catalog'
Get-Content -LiteralPath 'docs/superpowers/checkpoints/ACTIVE-GEO-PROGRESS.md' -Raw
git status --short --branch
git log -6 --oneline
node geo-site/scripts/progress.mjs
```

只有 GitHub 状态影响下一步时，才运行一次 `node geo-site/scripts/progress.mjs --refresh`。发现用户未提交修改要保留，不执行 `reset --hard`、`checkout --`、强推或整目录覆盖。

## 2. 当前到底做到哪一步

### 2.1 已有实现：不要重新开发

1. Python 后端 + Neon PostgreSQL，当前数据库代码版本 **schemaVersion=4**；不是原先依赖 EdgeOne Blob 的登录方案。
2. 主动密码登录、当前已登录标签页刷新后的服务端会话校验、退出清理、迟到响应隔离、8 小时会话绝对期限；不是把本地“已登录”标记当服务端授权。
3. 用户选择的 A 总览 + B 任务详情、紧凑字体、微软雅黑字体栈、冰蓝色、用户提供的原图 Logo 已接入。
4. 目录式个人设置；owner 独立管理中心；创建子账号、积分调整、有效期、共享 IMA 配置、缓存管理与流水。
5. 每账号最多五个未结束独立工作区。每个工作区各有 Excel、公司资料、模型、草稿版本和批次；不是一张 Excel 只能五行。
6. 草稿加密持久化、版本冲突检查、启动幂等、同事务积分预扣与固定模型/Key 快照。
7. 五个工作区前端独立推进、暂停/继续/取消、失败隔离；启动后不能换模型。
8. 站点共享的加密 IMA 缓存、缓存命中复用、owner 显式清代、运行批次固定缓存代数；用户自己的模型 Key 按账号隔离。
9. 按有效 Excel 行预扣 1 分；一行多篇全部成功才算该行成功，失败退款幂等。**当前成功依据仍是服务端完整 artifact，不是本地落盘。**
10. 文章当前生成 MD，服务器加密保存，可从 artifact 接口下载。
11. Python Worker 单进程最多五个执行槽已实现并做过本机无浏览器测试；**用户暂无常驻服务器，生产 Worker 未部署**。

### 2.2 完成状态必须分开说

| 层级 | 真实状态 |
| --- | --- |
| 本地业务代码 | e12d424 基线已实现上述能力；以历史测试记录为证据 |
| GitHub | 已只读核实 master=e12d424 |
| EdgeOne | 用户新截图显示生产 master/e12d424、运行中；这是用户提供的部署记录证据 |
| 用户现场反馈 | 已可登录；批次工作区先点左下角“新建任务”后可以操作，但交互需要等待 |
| 最新线上 health/schema | 本轮没有取得生产 `/api/health` 响应，不用截图代替该项 |
| 上游真实 IMA/AI | 既有自动化大多使用固定上游响应；没有证据证明当前所有厂商 Key 均真实成功 |
| 关闭网页持续运行 | 生产无常驻 Worker，不能保证；未来 Worker 也不能替关闭的浏览器写用户硬盘 |
| 本地目录与保存回执 | **尚未实现** |
| 本地成功后清正文、按本地交付结算 | **尚未实现** |
| 此轮 UX 修复 | 已定位，尚未修改业务代码 |

历史文档含“未推送”“五工作区未实现”等较早段落。优先使用本文件、恢复入口和检查点顶部新记录，不把历史阶段当现在的未完成项。

### 2.3 历史验证的边界

本机真实 Edge + FastAPI + 隔离 PostgreSQL 已覆盖登录、成员权限、五工作区、草稿冲突、五路生成、四个实际 MD 文件及第五失败退一分；Worker 也有无浏览器五路验证。IMA/模型是固定测试响应，不是生产 Key 调用。

代码没变时不要为“看起来在干活”重跑全部旧测试。修改哪个模块，就补对应失败用例、回归依赖路径；新本地交付涉及账务与删除，必须新增实际文件与真实事务验证。

## 3. 用户已确定的要求与不可擅自改变的边界

- 本地保存：首次使用让用户选择自己的文章根文件夹；同账号、同网站、同浏览器配置可复用授权目录。更换电脑、浏览器配置或清除站点数据后可以需要重新选择。
- **已选方案：文章临时加密中转，本地成功保存后清除在线正文。** 不选择“只放浏览器内存、丢失无法恢复”的方案。
- 模型 API Key 录入方式保持现状，各子账号使用自己的 Key；不重做 ima 式模型配置界面。
- IMA 使用站点所有者的资料和凭据，不要求子账号购买/配置各自 IMA。
- 一条有效 Excel 任务行 1 积分；五行有一行没有完整交付，返还一分。不是按缓存请求数、模型调用数或文章篇数收费。
- 五个独立工作区并行；每个运行批次锁定自己的模型，不中途切换。
- owner 管理与成员个人设置分离，权限必须服务端强制，不只是隐藏菜单。
- 到期不能继续发起生成，积分和续期由 owner 手工维护；续费联系复用现有微信二维码，不加入在线收款。
- 保留 A+B 布局、紧凑字体、蓝白配色、原图 Logo 和现有人物素材；本次只修空状态与交互，不再整体放大字体。
- 不购买服务器、不假称已部署 Worker、不批量调用生产模型验证、不打印任何密钥。
- 不自动清理历史文章，不追改旧账，不轮换 `GEO_MASTER_KEY`。

## 4. 已定位的 UX 问题与证据

### 4.1 为什么进“批次工作区”像不能点

`src/app.js` 的导航只切换页面；`src/workspace-ui.js` 在未选择已创建草稿时将 `.geo-workspace` 设为 `inert`，文件输入和启动按钮被禁用。这是防止资料写进不存在工作区的保护，不能简单移除。

真正问题是页面仍展示完整上传表单，用户看不出“先新建或选择工作区”。用户已确认左下角新建后可以操作，所以不能继续诊断为生成接口一定失效。

**修正：** 无选中工作区时显示明确空状态和“新建任务”按钮；有工作区则显示可选择列表/最近工作区入口。点击侧栏导航本身不偷偷占用新名额。所有新建入口复用同一个幂等创建方法。

### 4.2 为什么新建有明显“缓一下”

受控浏览器诊断中，创建请求等待时按钮已 disabled，但文字仍是“新建任务 / 名额 0 / 5 · 可新建”；正文仍提示“请选择工作区或新建任务”。响应返回后才恢复可上传。

**已证实是缺少等待反馈，不等于已经测出生产网络慢的根因。** 需要保留创建中禁重复点击，立即显示“正在创建…”，失败显示原因和安全重试入口；返回成功后明确聚焦新工作区。

代码还存在 settings → history、batches → workspaces 的串行加载，以及工作区摘要逐项读取/解密完整草稿再丢掉正文的路径。它们是可测量的优化点，但不能未经生产测量就声称当前全部卡顿由 N+1、Neon 冷启动或某云平台造成。

### 4.3 为什么总览没有图案

- `index.html` 的侧栏“任务总览”按钮确实没有 SVG 图标，其他部分导航有。
- 人物图片本身可加载，但 `.console-brand-note` 在较大的空白面板下方，短视口/缩放下会落在首屏外。

**修正：** 补一致线性图标；将现有人物以小型插图放入总览空状态，旁边配说明与新建按钮。不是重新生成素材、也不是把人物放大占据整个工作区。

## 5. 总体数据流与存储边界

```text
子账号主动登录
  → 选择/恢复本机目录授权
  → 新建或打开独立工作区
  → 上传 Excel 与公司资料、选择已配置模型
  → 校验订阅/积分/目录权限/有效行
  → 服务端原子预扣，固定模型 Key 与 IMA 缓存代数
  → 读取必要共享缓存；缺失才访问 IMA
  → 用户自己的模型生成、审核
  → 完整 MD 临时加密中转
  → 浏览器写入本地，关闭写流，读回校验字节数与 SHA-256
  → 提交本人保存回执
  → 服务端事务内记录交付、结算相应 Excel 行、清除在线正文
  → 仅保留任务/账务/交付元数据，继续下一篇
```

| 数据 | 存放位置 | 后续策略 |
| --- | --- | --- |
| 登录、订阅、积分、审计 | PostgreSQL | 必须保留，保证 SaaS 权限与账务 |
| 子账号模型 Key | PostgreSQL 加密 | 保持现有账号隔离，不传回明文给页面 |
| 共享 IMA 缓存 | PostgreSQL 加密 | 保持 owner 清代机制，不因保存文章而清缓存 |
| 工作区 Excel/公司草稿 | 现有 PostgreSQL 加密工作区 | 本次不顺带删除；这是恢复独立工作区所需数据 |
| 已审核、未交付 MD | PostgreSQL 临时加密 | 本地回执成功后清正文；未确认不得先删 |
| 已交付 MD | 用户选择的本地目录 | 用户自行保管、备份；站点不承诺可再次下载正文 |
| 目录句柄、待发送回执 | 本机 IndexedDB | 按账号隔离；不保存 API Key 或原始 Cookie |
| 已交付文章摘要/哈希/时间 | PostgreSQL | 保留用于历史显示、幂等和对账，不保留正文 |

“文章不永久占用网站存储”不等于完全不需要数据库，也不等于能立即抹掉 Neon 历史备份/WAL。清理范围是当前在线记录中该文章的正文副本；备份保留政策另行管理。

## 6. 本地目录设计

### 6.1 页面入口

个人设置新增“文章保存”目录页：显示浏览器支持情况、已选文件夹名称、授权状态、选择/重新授权/更换按钮、待补存数量。登录后若未设置，展示一次清晰引导；可以查看历史和设置，但新生成前必须通过目录检查。

首次选择必须由用户点击按钮触发 `showDirectoryPicker({mode:'readwrite'})`，不要先 await 网络请求再调系统选择器。不要让用户输入 `D:\文章` 就宣称已经取得磁盘权限。

### 6.2 同设备记忆与账号隔离

IndexedDB 保存结构化的 `FileSystemDirectoryHandle`，键使用服务器确认的稳定账号标识，不使用 Cookie、CSRF、输入框账号或全站单一 `lastDirectory`。

当前 `/auth/login` 和 `/auth/session` 只返回 authenticated/csrf/expiresAt，没有稳定用户 ID。建议在已认证返回中增加非秘密的 `accountScope`，由服务端当前 user ID 生成稳定不透明值；它只用于本地命名隔离，**不能作为服务端授权凭证**。不为此新增环境变量或暴露主密钥。

恢复句柄后先 `queryPermission`；需要再次授权时显示按钮，由用户点击触发 `requestPermission`。退出时停止写盘队列、撤销当前内存引用、隔离旧响应；本机账号键下的句柄可留存供该账号下次主动登录复用，并提供“忘记此设备目录”操作。该操作只忘记设置，不删除用户文章。

同一浏览器配置下的网站脚本属于同一信任边界，不能把 IndexedDB 分账号键吹成操作系统级隔离；公用电脑应使用独立浏览器配置并谨慎授权。

### 6.3 文件夹和文件命名

推荐在授权根目录内建立：

```text
所选根目录/
  零雪GEO/
    accountScope/
      workspaceId/
        batchId/
          001-品牌名-artifact短ID.md
          002-品牌名-artifact短ID.md
```

采用稳定 ID 保证五个工作区与重复补存不混淆。品牌名仅为展示便利，要去掉路径分隔符、控制字符、Windows 保留名、尾随空格/点，限制长度；不能信任服务端文件名直接拼路径，更不能允许 `..` 越界。

已有同名文件：读回后哈希相同则复用，不再次写；哈希不同则另建冲突文件名或要求确认，禁止覆盖用户修改过的文章。变更根目录只影响后续保存与明确补存，不自动搬家/删除旧文件。

本机交付索引还应保存 artifactId 对应的文件句柄或原根目录引用及相对位置，不能更换根目录后丢失旧文章位置。文章列表区分“待补存”和“已在本机保存”；后者只显示记录及有权限时的本机查看入口，不再提供必然返回 410 的“从服务器重新下载”。换到另一台电脑可见历史元数据，但明确提示文件保存在原设备，不能假装已复制到新电脑。

浏览器通常只能可靠展示授权文件夹名称与应用内相对路径，不承诺能读出 `C:\Users\某人\...` 的真实绝对路径。

### 6.4 浏览器兼容

运行时检测 `window.isSecureContext`、`showDirectoryPicker` 和必要句柄/存储能力。用户截图使用夸克，不能仅因为 Chromium 内核就断言支持全部持久授权功能；必须实机验证。

不支持自动目录保存时，允许查看历史和手动下载既有文件，明确建议使用经实测支持的桌面 Edge/Chrome。**不要把普通下载按钮触发当作自动落盘确认，更不能据此清正文。** 新“本地交付”任务在不支持环境下先阻止启动并解释原因，不能悄悄退回永久云存储。

依据：[Chrome File System Access 文档](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)、[MDN showDirectoryPicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)。这些接口要求用户授权，支持情况与权限持久性必须现场检查。

## 7. 本地交付状态机

### 7.1 新旧模式隔离

建议新批次固定 `deliveryMode='local_confirmed_v1'`；迁移前旧批次固定 `deliveryMode='server_legacy'`。模式由服务器按版本/创建策略决定，不能让前端改请求参数绕过计费或保存要求。

旧模式保留原来下载与账务语义，不自动删历史 artifact、不追扣/退款。若将来要迁移历史文章，单独设计用户明确确认的“本地归档”流程，不混入此次自动迁移。

新建启动接口建议要求 `deliveryProtocol: 1`，不符合者返回明确的客户端版本不支持提示。该字段只是协议版本，不证明用户已授权目录，也不让客户端选择低保障计费模式。工作区 start 与仍存在的直接 POST batches 两个入口都必须受同一新策略约束；已有请求的幂等重放返回原批次，不把旧批次改成新模式。

### 7.2 各类状态必须分开

| 对象 | 建议状态/解释 |
| --- | --- |
| 工作区 | 沿用 draft/started/archived，不能以归档绕过退款 |
| 批次 | 保留原状态，新增 `awaiting_save`；未完整交付不能冒充 completed |
| 文件交付 | `pending` → `delivered`；明确取消可到 `discarded` |
| 积分行 | 沿用 reserved/complete/refunded/released；complete 依据按模式分支 |
| Worker job | 新增 `waiting_local`，等待交付不应不断轮询占执行槽 |

`awaiting_save` 是等待浏览器补存，不是模型生成错误。界面文案分别显示“已生成，等待本地保存”“已保存，正在确认”“已交付，在线正文已清除”。

当前 `batch-runners.js` 遇到非 ready 会结束本轮驱动，且 finally 会调用 onFinish；因此不能把 onFinish 简单解释为业务成功。收到交付成功响应后重新读取当前 batch：仅在当前账号仍有效、状态 ready、没有用户暂停/到期/取消意图时重新启动该批次驱动。Worker 的 finish_job 也必须把 awaiting_save 映射到 waiting_local，不能沿用“非终态一律 queued”的现有逻辑。

### 7.3 暂存数量与关闭页面

推荐第一版每个工作区至多一篇“待交付”成品。保存失败则暂停该工作区后续模型调用，不影响另外四个工作区；写盘/回执成功后继续。最多五个未结束工作区的服务端约束也适用于 awaiting_save，不因等待保存释放名额。

这样避免硬盘没权限却继续生产大量临时文章。多篇任务逐篇交付，同一 Excel 行最终仍只结算一次。

当前生产没有 Worker，必须保持网页运行。未来即使部署 Worker，也不能在用户关闭浏览器后写其本地目录；达到待交付上限应等待用户回到页面。**本地优先与“关页后整批自动落在用户电脑”不能同时承诺。**

### 7.4 未确认文章的保留政策

用户只授权“保存成功后清在线正文”，未授权“超过某小时自动删除未保存文章”。本方案第一版默认不按 24/48 小时自动删除未确认文件：通过每工作区一篇待交付和五名额限制控制数量；页面列出待补存项目，可重试，或由用户明确选择放弃并退款。

因此“临时”描述的是交付周期，不承诺无人访问时固定时刻清理。若要 TTL 自动清理，需另行确定保留期限、通知、退款、管理员操作和真实定时执行器，不能在无常驻服务情况下声称已定时执行。

## 8. 回执、清理与账务：必须同一条可靠链路

### 8.1 浏览器正常路径

1. 获取本人待交付文章清单，含 artifactId/batchId/任务行标识/filename/byteLength/sha256/deliveryState。
2. 验证当前登录账号与目录匹配；检查权限；领取本机同 artifact 写入互斥锁。
3. 下载已有 artifact，不重新调用 IMA/大模型；按返回二进制字节写文件，不改变换行/BOM 导致哈希不一致。
4. 等待 `createWritable → write → close` 全部成功；再 `getFile` 读回，校验字节数和 SHA-256。
5. 在本机 IndexedDB 记录仅含元数据的待发送回执，再向服务端 POST；正文不放回执中。
6. 服务端确认后清本机 outbox，页面标记“已保存到本机，在线正文已清除”。

如果第 5 步请求丢失，刷新后先重试相同回执或查 manifest，不能因为 GET 正文已被清理就误判生成失败。若上次只有文件写完但没有 outbox，按稳定文件名读回校验后补回执。

### 8.2 建议新增 API 契约（当前没有这些接口）

对外 URL 带 `/api`；`geo_backend/app.py` 内部沿用现有挂载方式定义不带 `/api` 的 route。

| 接口 | 作用与约束 |
| --- | --- |
| GET `/api/artifacts/pending` | 分页读取当前账号待交付摘要；不传 userId 指定别人；静态路径注册在 `{artifact_id}` 动态路由之前 |
| GET `/api/artifacts/{artifact_id}/manifest` | 本人元数据、哈希、字节数、交付状态；不返回正文或完整本地路径 |
| GET `/api/artifacts/{artifact_id}` | 沿用正文下载；pending/legacy 可读；delivered/discarded 返回明确 410，不重新生成 |
| POST `/api/artifacts/{artifact_id}/local-receipt` | `{requestId, sha256, byteLength}`；请求体严格拒绝多余字段，Origin/CSRF/本人会话必需 |
| POST `/api/workspaces/{id}/start` | 扩展当前 `{version}` 为 `{version, deliveryProtocol:1}`；新增专用请求体，不误改 save/archive 的版本契约 |
| POST `/api/batches` | 仍保留的直接创建入口执行相同协议版本/交付策略，防止旧页面绕过工作区新规则 |
| POST `/api/batches/{id}/cancel` | 沿用接口并完善新模式：明确放弃待交付内容、结算未成功行、清未交付在线正文 |

回执建议成功响应：`{artifactId, deliveryState:'delivered', onlineBodyCleared:true, billingStatus, batchSeq}`。丢响应后重试返回一致语义，不能第二次扣分或第二次推进生成序号。

未登录保持 401，已登录但文件不存在/不属于本人统一 404；只有本人已清正文的文件才能得到 410，不暴露别人文章曾存在。账号过期但仍能认证时，应允许读取和补交付之前已有的文章；不能借补存启动新的模型调用。

建议严格输入约束：requestId 为规范 UUID；sha256 为 64 位小写十六进制；byteLength 为严格正整数（拒绝 bool/字符串），且须与服务端 manifest 完全相同。同一个 requestId 用于不同 artifact/payload 返回 409；同一 artifact 已成功则返回既有结果，不因换一个 requestId 再结算。pending 分页建议 limit 默认 20、最大 100，游标按 created_at/id 排序并始终受本人账号条件约束。

### 8.3 服务端事务约束

在统一锁顺序下完成：认证授权 → 锁定批次及对应积分/交付行 → 验证归属和 artifact 的审核结果/实际哈希 → 幂等记录回执 → 清该文件在线正文及重复正文 → 检查该 Excel 行是否全部交付 → 结算或继续保留预扣 → 更新批次/唤醒后续 job → 提交。

实现前先审计现有 `lock_user`、批次步骤锁、积分账户锁、job 租约的顺序，所有新增确认、取消、退款路径采用一致顺序；不得为了省代码新增与现有路径相反的锁顺序。HTTP 大模型请求与浏览器磁盘 I/O 不能放进长数据库事务。

以同一事务保证“已删正文但无回执”“退了分又被迟到确认扣回”“Worker 写回旧正文”不会出现。ACK 修改批次内容必须使用与生成步骤一致的互斥/CAS，更新 seq，避免迟到 save_batch 把已清正文覆盖回去。

### 8.4 清理哪些内容

不只清 `article_artifacts.content_cipher`。还要盘点批次 `draft`、`_pendingArticle`、可能的旧版内联 markdown、错误详情/日志与前端内存中是否保留该篇正文。

- 数据库保留 artifact 元数据墓碑、回执和账务关联，不删除整条文件记录导致幂等与对账失效。
- 批次加密状态中的已完成文章正文副本清除；正在生成的下一篇、共享 IMA 资料、用户公司文档不误删。
- 文本不能写进异常日志或监控 payload；前端不把全文持久化到 localStorage。
- 不承诺清除历史备份，也不删除用户已保存的磁盘文件。

### 8.5 积分规则示例

| 场景 | 新模式应有结果 |
| --- | --- |
| 5 个有效 Excel 行，各 1 篇，都交付 | 启动预扣 5，最终消耗 5 |
| 5 行，4 行完整交付，1 行生成最终失败 | 退 1，净消耗 4 |
| 某行要求 3 篇，只有 2 篇生成/交付成功，第三篇最终失败 | 该行退 1；已交付两篇不删除 |
| 暂时断网/磁盘无权限，但尚未放弃 | 保留待交付与预扣，不立刻重复生成或双重退款 |
| 用户明确取消未完整交付的一行 | 只退该行 1 次，清未交付在线内容，保留元数据 |
| 已交付行重复 ACK / 重复取消 | 不重复扣分，不退款已完成行 |
| 只点击普通下载，但未获得可验证的自动写盘结果 | 不当作本地确认，不清正文 |

现有 `settle_task_credit` 会依据 `_task_artifacts_complete` 自动判成功，即使调用方传入 complete=False。**必须按 deliveryMode 修改该成功判定，而不只是改前端状态。** 新模式要求对应行全部 artifact 有有效交付记录；旧模式保持原服务器完整文件判据。

已退款行不能被迟到 ACK 重新消费；已确认的历史 ACK 可重复读取既有结果，不再次推进。取消与在途生成竞争时保持原租约/步骤锁，不能在退款后又产出新的可领文件。

**订阅到期需要与用户主动丢弃区分。** 推荐到期后禁止任何新模型调用，已完整交付行保持消费，尚未完整交付行按原到期承诺退款；已生成而尚未写盘的内容仍保留给本人补存，不由到期事件自动删除。记录终止原因为 subscription_expired：随后收到该已退款行的合法回执，只完成交付/清正文，不重新扣分、不恢复生成。存在待交付时保留 awaiting_save 名额，补存结束后到 cancelled；没有待交付则直接 cancelled。用户明确取消并放弃时才将 pending 标记 discarded 并清正文。相应 UI、Worker、退款与测试均使用该区分，避免“允许到期补存”与“退款后拒绝所有回执”相互矛盾。

### 8.6 必须如实说明的信任边界

SHA-256 能验证内容一致性，但服务器不能仅靠浏览器上传的哈希证明用户真的把文件写进物理硬盘。前端可被修改，已收到正文后恶意拒绝 ACK 以求退款无法完全技术消除。

第一版采取本人权限、严格 manifest 校验、唯一回执、不可复用的 artifact 身份、事务幂等、审计与异常模式可见性；不能宣传“绝对防刷”。更强商业风控或改成下载即消费，会改变当前承诺，必须另行获得用户确认。

## 9. 数据库升级建议：v4 → v5

使用 `schema.py` + `database.py::ensure_schema` 的现有幂等迁移机制，不建立一套并行迁移框架。若接手时已有其他 v5 迁移，使用下一版本号并同步 health；不要覆盖别人版本。

当前 ensure_schema 中不仅有 SCHEMA_VERSION 引用，还有显式插入 version=4 的 SQL；升级必须同时增加实际 v5 迁移与迁移记录，不能只把常量改成 5，否则 health 的 ready 判断与真实结构会不一致。

建议结构：

- 批次保存不可变 deliveryMode，旧记录明确 backfill 为 server_legacy；新版本创建新批次固定 local_confirmed_v1。
- article_artifacts 增加 delivery_state、delivered_at、purged_at；保留 id/tenant/user/batch/task/filename/bytes/hash/audit/status。
- 当前 content_cipher 为 NOT NULL，要受控改为可空并增加约束：pending/旧在线文件需要密文；delivered/discarded 允许且要求清除密文。不能写空字符串伪装已清理。
- 新增 article_delivery_receipts，唯一约束 artifact_id，并对 user_id+request_id 做幂等约束；记录服务器确认时间、hash/bytes，不存正文、Key、绝对目录。
- jobs 新增 waiting_local 状态及相应 CHECK 更新；batches 使用 awaiting_save（13 字符，适配当前 VARCHAR(16)），不要直接写超长状态名。
- 新增按 user/tenant/delivery_state/created_at 的待交付查询索引；分页，禁止读取全文再过滤。
- 为摘要优化增加小型加密摘要或等效专用读取路径；公司文档/Excel/密钥不得为提速而改成明文列。旧摘要可惰性回填，避免所有请求扫描全表大事务。

迁移必须保持旧文章可下载、旧积分余额/流水不变、IMA 缓存代数不变、主密钥不变，重复初始化安全。迁移成功前不启用新前端交付入口。旧 API/Worker 不能混跑新本地交付模式；发布前停止在途步骤，采用向前修复，禁止随意回滚到不理解已清正文的版本。

## 10. UX 与加载性能实施方案

### 10.1 立即可感知的操作反馈

- 新建按钮显示“正在创建…”并保留五名额说明；重复点击只对应一个 requestId。
- 页面切换立即切换可见骨架/已有快照，不等待所有历史和管理数据串行完成。
- 空工作区表单用引导替代；已有工作区仍通过显式选择打开，避免跳入他人/上次账号数据。
- 首屏失败显示“加载失败，重试”，不要一直显示空列表假装没有任务。
- 保存中、新建中、读取中、正在启动分别显示状态；设置 aria-busy 与 role=status，不能仅靠颜色。
- 保留 dirty 草稿 flush、CAS 冲突、请求不明冻结、认证 epoch 隔离；提速不能以取消这些保护为代价。

### 10.2 减少不必要请求

- 为 settings/overview 读取增加当前认证代数内的 in-flight 合并，重复导航不叠请求。
- 独立 GET 可以并行；依赖 settings 的模型初始化、身份/权限检查不能盲目并行或跳过。
- owner 成员列表只在管理页面需要时读取，普通成员不发管理请求。
- 工作区列表服务端直接读摘要，打开某个工作区才取完整加密草稿；批次历史也检查是否读取了不必要全文。
- 内存摘要用于快速渲染，保存/启动/取消/确认交付/充值/续期后失效或精确更新；不把旧缓存用于服务端计费授权。
- 前端退出登录清所有账号级缓存；迟到响应不能填入新账号。

### 10.3 测量而不是猜测

新增受控慢响应测试，用未完成 Promise 暂停创建响应，断言下一帧已展示创建中、只发一次 POST，响应释放后上传可用。不要用固定 sleep 几秒模拟“修好了”。

在安全日志中只记录路径、状态、耗时、请求关联 ID，区分网络等待/服务端查询/渲染；不记录正文、密码和 Key。真实环境先测再报告 P50/P95，不编造本次已达到某个毫秒数。

## 11. 文件导航：哪些文件负责什么

以下都是相对第 1 节开发根目录的路径，不是外层旧 master。

| 文件 | 当前责任 / 本轮预计修改 |
| --- | --- |
| `geo-site/index.html` | 正式 DOM、侧栏图标、总览空状态及文章保存入口 |
| `geo-site/styles.css` | 冰蓝紧凑样式；仅补目录/状态/空态，不全局放大 |
| `geo-site/src/app.js` | 页面导航、上传解析、草稿资料与 UI 集成 |
| `geo-site/src/console-view.js` | 个人/管理目录、总览、详情三页签、文章列表 |
| `geo-site/src/workspace-ui.js` | 草稿选择/保存/创建/启动/五页签，增加统一新建与操作反馈 |
| `geo-site/src/runtime.js` | 认证后初始化、API、设置与历史读取、下载及交付协调 |
| `geo-site/src/auth-flow.js` | 保留认证代数与旧响应隔离，与本地写盘队列重置联动 |
| `geo-site/src/batch-runners.js` | 每批次独立步骤执行；识别 awaiting_save，不轮询发模型 |
| `geo-site/src/local-output.js`（拟新增） | 目录句柄、权限、账号隔离、IndexedDB、本机安全文件名与读回校验 |
| `geo-site/src/article-delivery.js`（拟新增） | 待交付协调、幂等 outbox、确认重试、单文件互斥与 UI 状态 |
| `geo-site/cloud-functions/geo_backend/app.py` | accountScope、manifest/pending/receipt 路由、严格请求体与现有权限 |
| `geo-site/cloud-functions/geo_backend/artifacts.py` | 完整文件与元数据、已清正文结果；不能把 410 当再次生成理由 |
| `geo-site/cloud-functions/geo_backend/delivery.py`（拟新增） | 单一职责的交付业务服务，协调确认/丢弃/行结算 |
| `geo-site/cloud-functions/geo_backend/repository.py` | 真实 SQL、artifact/回执/账务事务与旧模式兼容 |
| `geo-site/cloud-functions/geo_backend/batches.py` | deliveryMode、待本地保存阻塞、成功依据、草稿正文清理 |
| `geo-site/cloud-functions/geo_backend/credits.py` | 保留按行计费入口，成功定义与退款配合 repository 修改 |
| `geo-site/cloud-functions/geo_backend/workspaces.py` | 五名额/状态/列表摘要逻辑，禁止 awaiting_save 释放名额 |
| `geo-site/cloud-functions/geo_backend/workspace_repository.py` | 工作区摘要读取/加密摘要及数据访问隔离 |
| `geo-site/cloud-functions/geo_backend/schema.py`、`database.py` | v5 结构、约束、迁移与 health |
| `geo-site/cloud-functions/geo_backend/worker.py` | waiting_local 不领执行槽，ACK 后只推进下一步，不重复上游请求 |
| `geo-site/src/model-switch.js`、`geo_backend/models.py`、`providers.py` | 保留现有模型录入/目录/请求适配；若发现某 ID 无效，按官方资料单独修正并验证 |
| `geo-site/scripts/check-console-layout.mjs`、`check-login-flow.mjs` | 有改动关联时定向浏览器回归 |
| `geo-site/tests_postgres/serve_ui_fixture.py` | 本机实际 UI/API/PG 联调夹具，上游固定响应 |

注意：上表简称 `geo_backend/models.py`、`providers.py` 的完整前缀是 `geo-site/cloud-functions/geo_backend/`。不要编辑 `dist`、`__pycache__` 或 node_modules 当作源码修改。

## 12. 分阶段实施顺序与检查点

### 阶段 A：先修 UI 操作反馈，独立交付

- [ ] 新增 `geo-site/scripts/check-workspace-feedback.mjs`：复现空工作区、等待中按钮、重复点击、图标/人物和失败重试；对当前基线应断言失败。
- [ ] 在 workspace-ui 暴露单一 create 操作供侧栏与空态复用，保留 pendingCreate/requestId、flush 与五名额规则。
- [ ] console-view/index/styles 接入空态、图标、适当大小的人物；不改计费与 API Key 录入。
- [ ] 实际 Edge 检查桌面短视口、1280/1920px、390px 手机、浏览器缩放；无横向溢出、无过大字号。
- [ ] 先单独建立 `fix: clarify workspace creation and loading states` 检查点；更新进度。不要把此阶段叫作本地保存已完成。

### 阶段 B：本地目录与账号上下文，不先开启自动清理

- [ ] 新增 `src/local-output.test.mjs`：句柄复用、拒绝/撤销权限、取消选择、写失败、close 失败、读回不一致、同名冲突、账号隔离。
- [ ] 新增 accountScope 已认证返回契约与认证重置测试；匿名请求不获得用户上下文。
- [ ] 实现 local-output.js 和“文章保存”目录页，目录选择由按钮用户手势触发。
- [ ] 提供专用临时测试目录；实际写入、close 后读回测试文件，不拿 OPFS 或 Blob 下载替身冒充用户授权目录实测。
- [ ] 该阶段仅证明目录授权/写盘，不启用生产文章删除。建立独立检查点。

### 阶段 C：数据库与交付事务

- [ ] 新增 `tests_postgres/test_local_delivery.py`，覆盖 migration、receipt、清理、退款与并发；新增 `tests_py/test_delivery.py` 记录业务错误契约。
- [ ] 先编写当前基线必失败的测试：一篇已生成未交付不能确认积分成功；同一回执两次只有一条记录；清理失败事务全部回滚。
- [ ] 实现 v5 幂等迁移、新旧 deliveryMode、字段约束与元数据回执；保护既有 v4 数据。
- [ ] 实现 delivery service/repository/API，认证、跨账号、CSRF、hash/bytes、退款后迟到回执逐一验证。
- [ ] 盘点并清除所有该篇在线正文副本；验证残留状态不能重建正文。
- [ ] 测试通过后独立提交，不先让新前端请求半成品 API。

### 阶段 D：运行器、写盘、积分连成闭环

- [ ] 新增 `src/article-delivery.test.mjs` 和 `tests_postgres/browser_local_delivery.mjs`；正式 bundle 接真实本机 API/PG，固定上游结果。
- [ ] 为新模式加 awaiting_save/waiting_local，统一前后端名额、暂停/取消/到期、批次完成定义。
- [ ] 实现本地 outbox、manifest 恢复、ACK 幂等与跨标签页互斥；不重发结果不明的模型请求。
- [ ] 五工作区并行：四份落盘成功；第五分别注入生成失败/本地写失败。校验一行最终失败仅退一分；暂时补存失败未放弃时保留待交付，不伪造失败退款。
- [ ] 验证“文件写完 → ACK 响应丢失 → 页面刷新 → 只补确认、不重生成、不重复扣分”。
- [ ] 验证“取消与 ACK 同时到达”“退出/换账号时 I/O 迟到”“同一行多篇部分成功”，保存检查点。

### 阶段 E：加载性能

- [ ] 先记录单次登录/新建/打开/返回总览的请求数与查询数，保留可比基线。
- [ ] 实施有界摘要读取、独立请求并行、in-flight 合并、按需管理数据加载。
- [ ] 新增定向测试证明多次导航不触发重复创建/模型、旧响应不覆盖新账号、摘要不返回全文/Key。
- [ ] 对照优化前后测量；未测生产冷启动就不归因，未达指标不声称“秒开”。保存检查点。

### 阶段 F：发布与生产验收

- [ ] 再确认准备发布时是否存在在途调用；用户之前说无任务不等于永远无任务。
- [ ] 按第 15 节执行迁移、构建、授权推送、EdgeOne 提交核对与最小真实验收。
- [ ] 只有真实用户目录文件存在、内容完整、在线正文已清且积分正确，才宣布本地交付完成。

## 13. 测试命令与验收矩阵

### 13.1 现有可用命令

以下在 `E:\codex\weijia\.worktrees\static-geo-model-catalog\geo-site` 执行。这里只记录命令，没有在本交接轮重复执行旧验证。

```powershell
# 前端和构建：根据实际改动选用
npm test
npm run build

# 受影响的既有 Python 单元，不要将 test:python 误当 pytest
.venv/Scripts/python.exe -m unittest discover -s tests_py -p test_artifacts.py -v
.venv/Scripts/python.exe -m unittest discover -s tests_py -p test_credits.py -v
.venv/Scripts/python.exe -m unittest discover -s tests_py -p test_batches.py -v
.venv/Scripts/python.exe -m unittest discover -s tests_py -p test_app_contract.py -v

# 真实 PG；先确认仅使用夹具指定的本机隔离库
.venv/Scripts/python.exe -m unittest discover -s tests_postgres -p test_workspaces.py -v
.venv/Scripts/python.exe -m unittest discover -s tests_postgres -p test_worker_pool.py -v

# 已有实际页面夹具；需先构建 dist
.venv/Scripts/python.exe tests_postgres/serve_ui_fixture.py --browser --workspaces
.venv/Scripts/python.exe tests_postgres/serve_ui_fixture.py --browser --workspaces --boundaries
```

新增文件写好后，定向命令：

```powershell
node --test src/local-output.test.mjs src/article-delivery.test.mjs
node scripts/check-workspace-feedback.mjs
.venv/Scripts/python.exe -m unittest discover -s tests_py -p test_delivery.py -v
.venv/Scripts/python.exe -m unittest discover -s tests_postgres -p test_local_delivery.py -v
```

新增浏览器测试须接入现有 fixture 启动/清理流程，使用临时隔离 schema 和独立输出目录；这些新增文件当前不存在，不应把运行“找不到文件”记为产品失败或已验证。

现有 PG 夹具限定 `127.0.0.1:55483`，临时 schema 前缀 `geo_test_`。不要把它改到 Neon 生产库，也不要为让测试通过创建/删除生产用户或积分。`npm run dev` 会读取 `.local/edgeone-secrets.json`，可能连接真实数据库，**不能当作天然隔离的验收环境**。

### 13.2 发布门槛

| 类别 | 必须通过的具体场景 |
| --- | --- |
| 目录 | 首次选目录、刷新复用、权限撤销重授权、拒绝选择、不支持浏览器、账号切换 |
| 写盘 | 多工作区不覆盖、中文文件名、路径穿越拒绝、磁盘失败、close 失败、读回 hash 不一致 |
| 回执 | 跨账号拒绝、重复请求、丢响应补确认、错误 hash/bytes、退款后迟到 ACK、并发 ACK/取消 |
| 清理 | 当前在线 artifact 及批次副本确实无该篇正文；事务中途失败可回滚；日志不含正文/Key |
| 计费 | 5 行四成功一失败净扣 4；一行多篇不按篇重复扣；重复退款一次；旧行账务不变 |
| 任务 | 五工作区独立、拒绝第六个、待交付占名额、一个待存不阻塞其他四个、模型启动后锁定 |
| 认证 | 新入口主动密码、退出后不回填、旧 401 不干扰新登录、跨账号文件和句柄不串 |
| 到期 | 不发新模型调用；未完整交付行退款，但保留已生成文件供补存；补存 ACK 不再次扣回积分 |
| 缓存 | 第二账号相同缓存命中不再调用 IMA，仍使用第二账号自己的模型 Key；清代不改在途资料 |
| 兼容 | v4→v5 重复迁移、旧 artifact 下载、旧账/缓存/主密钥保留；旧客户端不能绕过新模式 |
| UX | 新建立即反馈、慢响应不连点占名额、空态有入口、失败有重试、桌面/手机无重叠裁切 |

真实浏览器的操作系统目录选择与授权测试需要实际完成，不能仅给 window 塞一个假 handle 就写“真实本地保存通过”。模拟用于边界覆盖，实际本机文件检查用于落盘证明。

## 14. 配置与安全：只列变量名，不列值

已有服务端变量：`APP_ORIGIN`、`GEO_ACCOUNT`、`GEO_PASSWORD_HASH`、`GEO_MASTER_KEY`、`DATABASE_URL`、`IMA_ADMIN_SECRET`、`IMA_OPENAPI_CLIENTID`、`IMA_OPENAPI_APIKEY`。此方案默认不新增必须由用户重新填写的变量。

- `DATABASE_URL` 使用现有 Neon 完整连接串，保留 TLS 参数；`sslmode=require` 不应拆成无代码读取的独立小写环境变量。
- `GEO_MASTER_KEY` 不能随意生成替换，否则历史加密数据可能无法解密。
- 客户的模型 Key 在现有个人设置录入，不写入 HTML、Git 或交接文件。
- 不把 `.local`、数据库密码、管理员口令、二维码联系信息以外的私人信息复制进进度。
- UI 的“已配置”只说明存在配置，不等同 API 已连通；“测试通过”要有真实返回证据和时间。各模型当前真实 ID/权限仍按厂商官方资料和账户验证，不能只根据截图名称推断可调用。

## 15. GitHub 推送与 EdgeOne 发布流程

1. 完成阶段检查点，审查只包含本轮预期文件。业务测试按受影响范围运行，构建通过；检查不带 `.local` 或 secret。
2. 同步恢复入口和 ACTIVE-GEO-PROGRESS，明确哪些是实际通过、哪些只是方案。
3. 用户授权发布后才推送。网络核对 `origin/master` 是否前进，有分叉先检查，不强推、不覆盖别人提交。
4. 可以选择授权建立远端功能分支走 PR，或沿用此前授权的正常快进发布方式；两者不要混用。当前只有 master 是已确认生产关联分支。
5. 若发布 master，核对 EdgeOne 构建记录中精确提交 SHA、根目录 `geo-site`、安装 `npm ci`、构建 `npm run build`、输出 `dist`；Python Cloud Functions 单独由当前结构部署。
6. 发布时停止旧在途步骤；如未来已有 Worker，正常停止、等当前调用保存后用同 SHA 重启。不能强杀代替收尾，也不能混跑旧 schema 语义。
7. `/api/health` 检查目标 schema/ready、登录、子账号权限、目录选择、同机复用与五工作区。
8. 经用户同意，以一个明确测试行调用真实 IMA/一个已配置模型；检查本地真实 MD、哈希、正文清理、预扣/结算。用缓存命中测试验证没有多余 IMA 请求，不批量烧八家模型额度。
9. 对外分别报告“本地提交 SHA”“GitHub master SHA”“EdgeOne 部署 SHA”“生产真实验收结果”，任一缺证据就标未验证。

本轮只有交接资料，不执行新的 GitHub push、不触发 EdgeOne 发布、不改环境变量、不运行生产模型。

## 16. 常驻 Worker 是后续部署项，不是再写一个后端

代码已实现，暂时没有生产承载。未来用户提供主机后，复用相同代码和环境、同 PostgreSQL/主密钥，首轮单实例最多五槽，不开放额外公网 Worker 端口。

Windows 项目 geo-site 下的已有命令：

```powershell
$env:PYTHONPATH = (Resolve-Path './cloud-functions').Path
.venv/Scripts/python.exe -m geo_backend.worker --once
.venv/Scripts/python.exe -m geo_backend.worker --poll-seconds 2 --concurrency 5
```

**接真实配置运行这些命令会推进真实任务，不要为交接核对而执行。** `--once` 是一步，不是一整个批次；五槽是该进程总并发，不是每账号各开五个无限进程。

新本地交付模式要先支持 waiting_local 后再部署 Worker。关页时执行到待交付上限即等候，不能宣称服务器可直接访问用户 C/D/E 盘。

## 17. 可直接复制给 GLM 的开工指令

> 接续零雪 GEO 现有项目，不要从零重写。先读 `E:/codex/GEO-RESUME.md`，再在 `E:/codex/weijia/.worktrees/static-geo-model-catalog` 打开本方案和 `docs/superpowers/checkpoints/ACTIVE-GEO-PROGRESS.md`，核对 git status。当前本地开发分支 `feat/static-geo-model-catalog`，GitHub 仓库 `https://github.com/kudisengjie/weijia` 的生产分支 `master`，已核实代码基线 `e12d4244d51db8b408d51d6daf7af473b212dab9`；本方案之后的文档提交不等于新功能。先完成阶段 A 的空工作区引导、创建中反馈、总览图标与人物可见性，再按 B/C/D 实现本机目录、临时加密交付、回执清正文和按行最终结算，最后测性能与生产发布。保持五独立工作区、原 API Key 录入、共享 IMA 缓存、owner 管理隔离、主动密码登录、紧凑冰蓝 UI。用户没有常驻服务器，不购买资源、不宣称 Worker 已上线。每阶段先复现/新增失败测试，再实现并验证，更新进度和本地 Git 检查点。未经授权不清未交付或历史文章，不轮换主密钥，不推送生产，不调用真实模型。按本方案边界报告，不把模拟测试当真实上线。

## 18. 本文件复审方法

第一轮核对需求、现有代码、Git 状态和数据一致性：特别检查新旧模式、按行而非篇计费、确认/取消竞争、正文副本、关闭浏览器与五名额边界。

第二轮核对可执行性与安全：检查真实文件路径/命令、拟新增与现有文件区分、GitHub 分支事实、迁移限制、浏览器兼容、测试隔离、秘密信息与未授权删除/推送。

两轮审查是交接方案审查，不替代 GLM 后续代码审查、数据库迁移测试、实际文件落盘和生产模型验收。

### 第一轮复审记录：需求与技术一致性

已逐段核对本文与实际 auth/session、artifact、credit、workspace、batch-runner、Worker 和 schema 初始化代码，并修正以下问题：

1. 补上旧客户端和直接 batches 入口的协议约束，避免只改工作区前端留下绕行路径。
2. 明确等待写盘后的前端驱动重启、Worker 不再自动 queued，以及暂停/到期优先，避免任务停住或忙轮询。
3. 区分到期退款后的安全补存与用户明确丢弃，补全回执不可重新扣分的边界。
4. 指出 ensure_schema 的显式版本 SQL、awaiting_save 字段长度和原 content_cipher NOT NULL 限制。
5. 修正匿名 401/越权 404 的语义，补回执输入校验、幂等键冲突和分页边界。
6. 补充换根目录后的旧文件索引、另一设备只见元数据，以及本地文档未自动出现在 GitHub 的事实。

结论：上述方案矛盾已在本文修正；没有把任何拟开发功能标成已实现。

### 第二轮复审记录：交接可执行性与安全

重新检查修订后的方案、真实路径、命令入口、发布边界和状态转换，并做只读文档检查：

- 已核对 35 个现有文件/执行器路径，全部存在；9 个拟新增文件当前确实不存在，已明确标为开发任务。
- 文档没有待填占位；代码块成对。针对 API Key、带密码数据库 URL、密码哈希及主密钥值的格式扫描未发现匹配；这不是对未来代码的全面秘密审计。
- 测试采用现有 Node test runner/Python unittest；现有浏览器 fixture 参数已对照源码，未把真实配置的 dev/Worker 命令作为安全测试执行。
- 只读 GitHub 查询证明 master=e12d424，远端无同名功能分支；文档准确区分本地开发分支、生产分支及尚未推送的交接资料。
- 再次检查已保存后清理、待补存不自动删除、到期退款后不重扣、旧模式不追改、五名额与 Worker 待交付暂停，未发现未解决的方案冲突。
- 再次确认不把历史固定响应测试、用户部署截图或文件存在检查称为生产真实模型/新本地保存功能通过。

**两轮结论：交接资料可供 GLM 按阶段接手；当前未发现阻断交接的遗漏或矛盾。不能保证未来实现天然无错误，必须执行第 13 节与第 15 节的验收。** 本轮不修改业务代码，不重复运行旧业务测试。
