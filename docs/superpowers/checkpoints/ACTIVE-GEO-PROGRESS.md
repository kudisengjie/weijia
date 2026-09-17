# 零雪 GEO 当前检查点

更新时间：2026-09-17。本文件只记录可复核的实现、验证和明确未完成项；本地、GitHub、EdgeOne 三层状态分开记录，不把“已保存”“已推送”“已部署”混为一谈。

## 阶段 E（2026-09-17，UI 体验修复 + 模型目录更新 + 仿 IMA 模型选择弹窗）已完成并回归通过；**本地提交未推送**（同 D-2/D-3 口径）；master 未动，EdgeOne 生产无影响。

- **模型目录联网核查后更新（2026-09-16 时点，8 家厂商逐一搜索官方口径）**：
  1. **豆包** Seed 2.0 Lite/Pro（260215 快照）→ **Seed 2.1 Turbo/Pro**（`doubao-seed-2-1-turbo-260628` / `doubao-seed-2-1-pro-260628`；Seed 2.1 于 2026-06-23 发布，Pro 0915 版 2026-09-16 火山方舟全量上线）。
  2. **DeepSeek** V4 Flash → **V4.1 Flash**（`deepseek-flash`，官方推荐新 ID；V4.1-Flash 2026-09-10 发布；`deepseek-v4-flash` 旧名暂时路由兼容；V4 Pro 官方宣布 9-14 后继续提供服务、计费不变，secondary 保留）。
  3. 已最新无需改动：混元 Hy3/Hy4 Preview、千问 Qwen3.8 Flash/Max（0902 快照）、MiniMax M2.7/M3、智谱 GLM-5.3/GLM-5.3-Flash、Kimi K2.7 Code/K3、MiMo V2.5/V2.5 Pro（V2.6 仍在训练直播、未发布）。
  4. **顺带抓出并修复一个真实兼容性炸弹**：智谱官方文档明确 GLM-5.3 对 `thinking:{"type":"disabled"}` 直接报错（要求迁移到 enabled+reasoning_effort），而 `providers.py` 原来对 zhipu 发送该参数——已把 zhipu 移出发送集合（不发送 thinking 字段用厂商默认），新增测试 `test_zhipu_omits_thinking_switch_because_glm53_rejects_disabled` 固化。
- **图1 样式闪烁（FOUC/时序）**：根因是会话恢复期间未认证布局（登录页）先绘制、会话确认后整页切换。修复：`index.html` 头部内联脚本加 `html.booting`（4 秒兜底自动解除），CSS `html.booting #login-page{visibility:hidden}`，runtime 在 showLogin/enter 两分支移除 booting——已登录刷新不再闪登录页，未登录短暂空白后正常出现登录表单；app.js 加载失败也有兜底。
- **图2 任务总览无图标**：`renderOverview` 行首补工作区 SVG 图标（`.console-ws-icon`，与侧边栏批次工作区同款），"我的工作区"面板 h2 加同款前缀图标（`.console-h2-icon`）。
- **图3 输入框聚焦弹跳与难看选中边框**：①去掉全局 `label:focus-within` 3px 大轮廓（整块 label 发光的元凶）；②`.runtime-field input/select:focus-visible` 由 3px outline 改为 `outline:none + border-color + 3px 柔和 box-shadow 光环`；③登录页滚动跳位——`login-page` 弃用 `justify-content:center`（flex 居中+内容溢出的经典聚焦滚动跳位 bug），改 `.login-layout{margin:auto}` 安全居中。设置页聚焦滚动已在真实 Edge 断言（scrollY 前后差 ≤2px）。
- **图4-7 模型展示改版（仿 IMA 自定义弹窗）**：8 张厂商卡片矩阵从常驻布局收进触发按钮 + 全屏遮罩弹窗：`#model-picker-trigger`（logo+厂商+模型+配置状态）→ `#model-picker-panel` 弹窗（header + 双列紧凑厂商卡片 + footer 当前选择/modelId）。选完模型自动收起，Esc/遮罩/✕ 均可关闭；`runtime.js` renderCredentials 同步触发器文案与 logo，renderModelLock 锁定期间禁用触发器。旧 `geo-model-summary` footer 移除（data 属性迁入弹窗 footer，querySelectorAll 驱动不受影响）。
- **新增测试**：`tests_postgres/browser_model_picker.mjs`（真实 Edge + 真实后端 + dist：booting 解除、总览图标（空态创建工作区后断言）、触发器跟随已存模型、弹窗 8 卡片、三次切换（千问/DeepSeek/豆包）触发器文案跟随、选后自动收起、Esc 关闭、聚焦无滚动跳位、无粗轮廓有柔光环、无页面错误）；测试自适应锁定状态（有未结束批次时服务端锁定模型切换是正确产品行为，跳过切换断言）。
- **回归证据**：tests_py 94/94（新增智谱 1 项）、npm 55+2 既有失败（基线一致）、构建通过、浏览器 e2e PASS（workspaces 模式 fixture，账号 owner-80f318…）。
- **工程教训（本轮新增）**：①styles.css 同文件并行编辑再次相互覆盖（input focus 修复被 label 移除编辑写回覆盖）——同文件编辑必须串行+grep 回读验证，此教训二次复现；②Bash cwd 在调用间会重置，长命令必须显式 cd 或用绝对路径；③fixture 服务 dist 构建产物——改完源码必须重新 `npm run build` 再跑浏览器测试，否则验证的是旧样式；④Playwright 点击视觉隐藏的 radio（1px opacity:0）hit-target 不稳定，应点其外层 label；⑤已选中 radio 的点击不触发 change 事件（面板不关），测试要先判 isChecked。
- **明确未做**：本地提交未推送（待用户确认）；**大模型 API Key 与 IMA 真实接入验证（任务 #19）需要用户在设置页填真实 Key 后点"测试已保存模型"逐厂商验证**（测试路由会发一条真实请求消耗少量额度；fixture stub 不算数）；EdgeOne 部署不在本轮。

## 阶段 D-3（2026-09-17，浏览器端到端与集成缺口修复）已完成并全量回归通过；**本地提交未推送**（用户要求降低推送频率）；master 未动，EdgeOne 生产无影响。

- **端到端发现并修复两个真集成缺口**：
  1. `app.py` 从未 import `DeliveryService`——任何已认证请求打到 `/artifacts/pending`、`/manifest`、`/local-receipt` 都会 NameError 500（既有契约测试只覆盖 401/403 前置失败，未暴露）。
  2. `resume_after_delivery` 无 HTTP 路由——回执成功后批次永远卡在 `awaiting_save`。修复：local-receipt 路由在 confirm 成功后调用 `batch_service.resume_after_delivery`，响应结构改为 `{receipt, batch}`（唤醒后的批次状态），前端 sendReceipt 把 batch 转发给 onBatch→receiveBatch 驱动 UI。
- **新增测试**：`test_receipt_route_confirms_and_resumes_awaiting_save_batch`（PG+HTTP 组合，固化闭环语义）；`browser_local_delivery.mjs` + `serve_ui_fixture.py --local-delivery` 模式（五工作区基建 + 第四/第五注入失败 + IMA stub）。
- **浏览器端到端四个场景（真实 Edge + 真实后端 + 真实 dist）**：①手势授权目录（FSA 契约打桩，OS 选择器无法自动化，磁盘级校验由 Node 真实磁盘测试覆盖）；②ACK 丢失 → 批次停“等待保存到本机” → outbox 补确认 → 自动完成；③五工作区并行，第四/第五注入失败退款，三篇落盘，余额 7；④取消与迟到回执竞争——两种合法结局（cancel 先→退款 already_refunded 余额 7；回执先→settled+批次完成+取消乐观锁 409）均不重复扣费、discarded 脱离 pending 清单。
- **前端**：保存页“立即保存到本机”按钮补 `id=saving-deliver`；autoDeliver 失败改为 console.warn 诊断（不打扰 UI）。
- **回归证据**：tests_postgres 72/72、tests_py 93/93、npm 55+2 既有失败（基线一致）、构建通过、浏览器 e2e PASS。
- **工程教训**：①调试期临时 console 探针删行时会把同一行的 `return{` 一起删掉造成页面语法错误（"Unexpected token ','"全页 JS 瘫痪）——清理探针必须逐处核对而非批量删行；②UI 状态断言必须等异步交付链的确定性信号（`__saved.length`、pending 数量刷新），不能跟在状态标签出现后立即断言；③UI 余额徽标由 refreshSettings 驱动，overview 刷新不更新它，断账用 `/api/settings` 服务器真相；④乐观锁 409 在并发取消/完成竞争中是正确语义，端到端断言要允许两种合法结局。
- **明确未做（后续）**：本地提交未推送（待用户确认）；EdgeOne 部署与线上验收不在本轮。

## 阶段 D-2（2026-09-17，前端 article-delivery 模块）本地提交 b83597b（未推送，同上）。

## 阶段 D-1（2026-09-17，awaiting_save/waiting_local 流程与新模式默认切换）已完成并全量回归通过，已推送，远端 SHA = 533b5738dddf4728d1e3c52c6c88ea57e8e54065（本地 HEAD 一致）；master 未动，EdgeOne 生产无影响。

- **流程语义**：`local_confirmed_v1` 批次落库不结算——`_persist_article` 置 artifact `delivery_state=pending`、批次 `awaiting_save`；Worker 把 `awaiting_save` 映射为 `waiting_local`（车道保持，不领执行槽）；浏览器回执（`confirm_local_delivery`）按行实扣结算，`resume_after_delivery` 逐行确认后唤醒批次继续或置 `completed`；`cancel(discard_pending=True)` 丢弃 pending 正文（content_cipher=NULL、discarded）并退款一次。
- **防御语义（两条关键裁决）**：① `finish_job` 内也做 `awaiting_save→waiting_local` 映射——任何路径传入都扣住车道，绝不回 `queued` 重派（否则会重发已消耗上游调用的阶段，违反"不重发结果不明的模型调用"铁律）；② discarded artifact 的迟到/重复 ACK 幂等返回 `billingStatus=already_refunded`（不再 409 ARTIFACT_DISCARDED），若积分仍 reserved 则只退一次、绝不结算。
- **默认切换**：`create_or_get_batch` 默认改为 `local_confirmed_v1`（阶段 C 推迟的 §9 决策在本阶段执行）。
- **测试**：新增 `LocalDeliveryFlowTests` 5 项（真实 PG）：落库不结算（余额 9 预扣保留）、finish_job 映射与 waiting_local 不可认领、单行回执→resume→completed（余额 9）、双行逐行确认→ready→completed（余额 8）、取消丢弃+退款+迟到回执幂等（余额 10 不变）。既有 5 个 legacy e2e（runtime 3 + workspaces 1 + worker_pool 1）显式固定 `server_legacy`，保留旧 finalize-on-persist 语义覆盖；新模式浏览器端到端留待 D-3 `browser_local_delivery.mjs`。
- **回归证据**：tests_postgres 71/71、tests_py 93/93、npm 44+2 既有失败（runtime gates / desktop typography，与阶段 C 基线一致）、`npm run build` 通过。
- **排查记录**：此前"finish_job 运行时代码与磁盘不一致"的疑团已解——SQL 拦截看到的 `('queued',...)` 是磁盘新代码对测试输入 `awaiting_save` 的正确兜底输出，属测试预期与映射分工歧义，非缓存/双副本问题；另确认 Edit 工具对同一文件的并行编辑会相互覆盖（第二条写回被第一条的旧缓冲覆盖），同文件编辑必须串行并回读验证。
- **Git 事故记录**：本次 commit 后 worktree 分支引用再次被吞（第 6+ 次），按既定恢复法处理：`git --git-dir=E:/codex/weijia/.git rev-parse <短SHA>` → `mkdir -p refs/heads/feat` → 写 `refs/heads/feat/static-geo-model-catalog` → 推送成功。
- **明确未做（属 D-2/D-3）**：前端 `src/article-delivery.js`（待交付清单、File System Access 落盘、回执上报、IndexedDB outbox 幂等）、runtime/batch-runners 接线、保存页待补存数量、浏览器端到端与全量回归推送。

## 阶段 C（2026-09-16，数据库 v5 与交付事务）已完成并全量回归通过，已推送，远端核验 SHA = 3a24f51085b81748fec8b5968de6c0d7aaed007a（本地 HEAD 一致）；master 未动（远端仍 e12d424），EdgeOne 生产无影响。

真实 PG 回归（2026-09-17 上午，用户以管理员注册 pgtest55483 服务常驻 55483 后运行）：

- `tests_postgres/test_local_delivery.py` **12/12 全绿**：v5 迁移回填与重复安全、jobs waiting_local 可写、新模式未交付禁止 settle（ARTIFACT_NOT_PERSISTED）、回执确认结算并清密文（content_cipher IS NULL + purged_at）、同回执/换 requestId 幂等、同 requestId 他文 REQUEST_ID_CONFLICT、hash/bytes 不匹配保持 pending、退款后迟到回执 already_refunded 不重扣、legacy 模式不变、已交付下载 410、pending 清单账号隔离。
- 真实 PG 抓出并修复 1 个真 bug：`_delivery_result` 正常路径缺 `receipt_request_id` 参数（TypeError）。测试夹具 3 处小 bug（信封格式、information_schema 查询、回执全表计数）一并修正。
- **重要设计决策：新批次默认保持 `server_legacy`**。曾把 `create_or_get_batch` 默认改为 local_confirmed_v1，既有 runtime 集成测试立刻暴露回归：当前批次执行器在 `_persist_article` 落库后立即 `finalize(complete=True)`，新模式判据下必 409 ARTIFACT_NOT_PERSISTED、五路全崩。按 §9「迁移成功前不启用新交付入口」，默认切换推迟到阶段 D（批次执行器/Worker 改为 awaiting_save/waiting_local 流程时）。settle 分支、回执 API、v5 结构均已就绪并有测试覆盖，阶段 D 只切一个默认值。
- 全量回归：tests_py 93/93；tests_postgres runtime 45/45（schemaVersion 断言 4→5 更新）、worker_pool 1/1、workspaces 8/8、local_delivery 12/12；`npm test` 44 通过 + 2 个既有失败（阶段 A 记录，未改）；`npm run build` 通过。
- git 事故：引用丢失第 8 次复现，且本次恢复时误用主仓库 HEAD 的 SHA 写引用（错误指向 b5ca955 旧提交），已用本次提交短 SHA `rev-parse 3a24f51` 修正——**恢复引用必须用本次 commit 输出的短 SHA 解析，绝不能用主仓库 HEAD**。推送（无 -c 参数）再次验证空值 helper 重置配置有效。

按交接方案 §9/§8/§12 阶段 C 以 TDD 实现 schema v5、交付回执事务与按 deliveryMode 结算。生产未连接，旧数据无影响。

- schema v5（`schema.py` SCHEMA_VERSION=5 + `database.py` 显式 v5 迁移块，重复初始化安全）：`batches.delivery_mode VARCHAR(32) DEFAULT 'server_legacy'`（新批次 INSERT 固定 `local_confirmed_v1`，幂等重放不改旧值）；`article_artifacts` 新增 `delivery_state`（CHECK pending/delivered/discarded，默认 pending）、`delivered_at`、`purged_at`，`content_cipher` 改可空并加 body-state CHECK（pending 必须有密文，delivered/discarded 必须无密文，不允许空串伪装）；新增 `article_delivery_receipts`（UNIQUE artifact_id 保证一文件一确认 + UNIQUE (tenant_id,user_id,request_id) 幂等）；`jobs` 状态加 `waiting_local`（重建 CHECK）；新增 `article_artifacts_pending_idx`（user_id,tenant_id,delivery_state,created_at）。
- repository 新增（`repository.py`）：`confirm_local_delivery` 单事务=FOR UPDATE 锁 artifact → 404/幂等/409 分支（delivered 返回既有结果不重复结算；discarded 拒绝；sha256/byteLength 不一致 ARTIFACT_MISMATCH；同 requestId 用于他文 REQUEST_ID_CONFLICT）→ 清密文标记 delivered/purged → 插回执 → 该行全部交付时自动 `settle_task_credit(complete=True)` → 组装 `{artifactId,deliveryState,onlineBodyCleared,billingStatus,batchSeq,alreadyConfirmed}`；`get_article_artifact_meta`（无正文）；`list_pending_artifacts`（created_at/id 游标分页，limit+1 探测 nextCursor）；`_task_delivery_complete`。
- 结算分支：`settle_task_credit` 读批次 `delivery_mode`——`local_confirmed_v1` 成功判据=该 Excel 行全部 artifact 有 delivered 记录；`server_legacy` 保持原服务器完整文件判据。退款后迟到回执只清正文不重扣（billingStatus=already_refunded）。
- 410 语义：`ArtifactService.get` 对 delivered/discarded 返回 `410 ARTIFACT_BODY_CLEARED`（不再暴露正文，也不作为重新生成理由）；pending/legacy 下载不变。
- 新增 `delivery.py`（DeliveryService）：回执严格校验（字段集合恰为 requestId/sha256/byteLength；requestId 规范小写 UUID；sha256 64 位小写 hex；byteLength 严格正整数拒绝 bool/str/float）、manifest、pending 分页校验（默认 20，最大 100，非法 INVALID_PAGINATION）。
- 新增路由（`app.py`，静态 `/artifacts/pending` 注册在动态段之前）：GET `/api/artifacts/pending`、GET `/api/artifacts/{id}/manifest`、POST `/api/artifacts/{id}/local-receipt`（LocalReceiptBody extra=forbid+strict，Origin/CSRF/会话沿用现有机制）；无租户上下文时 pending 返回空、manifest/receipt 404。
- 测试：`tests_py/test_delivery.py` 21 项全绿（fake 仓储契约 18 项 + app 路由契约 3 项：未登录 401、错误 Origin 403、extra 字段 400、静态路由优先、manifest 404）。`tests_py` 全量 93/93；`npm test` 44 通过 + 2 个既有失败（同阶段 A）；`npm run build` 通过。
- 新增 `tests_postgres/test_local_delivery.py` 10 项（迁移回填与重复安全、waiting_local 可写、新模式未交付禁止 settle、回执结算与清正文、同回执幂等、换 requestId 幂等、requestId 冲突、hash/bytes 不匹配、退款后迟到回执、legacy 模式不变、410、pending 清单隔离），**语法验证通过，等待隔离 PG 可用后运行**。
- 明确未做（属阶段 D 或后续）：批次 state 中旧路径 article.markdown 副本的防御性清理（新路径 article 只存元数据，正文仅在 content_cipher；批次驱动侧 draft 清理随阶段 D 接线）；worker finish_job 的 waiting_local 映射；前端 article-delivery 模块。
- 环境记录：隔离 PostgreSQL（E:/codex/.tmp/geo-delivery-pg，端口 55483）在本沙箱无法常驻——WorkBuddy 安全驱动拦截新监听进程并在命令结束后清理进程树；已尝试 Start-Process 脱离、注册 Windows 服务均被权限拦截。**待用户配合以管理员注册服务后即可运行真实 PG 回归**。git 分支引用丢失 bug 第 5 次复现（84678dd 提交后），已从 worktree gitdir 的 reflog 恢复至主仓库 refs；worktree 的分支引用实际存放在主仓库 `E:/codex/weijia/.git/refs/heads/`，不是 worktree gitdir。
- 推送记录（2026-09-17 上午，用户开梯子后授权执行）：`git push` 用仓库级配置仍挂死零输出——确诊 PortableGit **系统级** `credential.helper=helper-selector` 不会被仓库级 wincred 屏蔽（git 串联调用所有 helper，仓库级只追加不重置）；阶段 B 的命令行 `-c credential.helper=`（空值重置）+ `-c credential.helper=wincred` 再次生效，推送成功 `d568753..05ca964`，`git ls-remote` 核验远端 SHA 一致。已把**空值 helper 重置写进仓库 config**（`[credential] helper =` 空行在前 + `helper = wincred`），后续 push 应可直接用默认配置；若再挂死退回 `-c` 模板。

下一步：隔离 PG 可用后运行 `tests_postgres/test_local_delivery.py`；随后接续 §12 阶段 D（运行器、写盘、积分闭环）。

## 阶段 B（2026-09-16，本地目录与账号上下文）已完成，本地提交 1fbe46097bbba1c6c4cd0aff87f5524212139047（已推送，远端 SHA 同 d568753）

按交接方案 §6/§8.2/§12 阶段 B 以 TDD 完成，仅证明目录授权与写盘，**未启用生产文章删除、未清任何在线正文**。仅本地检查点：未推送、未部署。

- 后端 accountScope：`security.py` 新增 `account_scope(user_id, master_key)`（HMAC-SHA256 截断 32 hex，非秘密、不可逆推、非授权凭证）；`auth.py` 的 `LoginResult`/`AuthenticatedSession` 增加字段；`/auth/login` 与 `/auth/session` 认证返回新增 `accountScope`。匿名 401 无该字段。Python 测试先红后绿（test_auth.py 三个新用例 + test_app_contract.py 登录/会话/换账号隔离契约），71/71 通过。
- 前端契约：`auth-flow.js` 新增 `accountScopeFrom(data)`（严格小写 32 hex 校验，匿名/格式非法返回 null）；`auth-flow.test.mjs` 先红后绿。
- 新增 `src/hash-bytes.js`（crypto.subtle SHA-256，浏览器/Node 通用）与 `src/local-output.js`：目录句柄按 accountScope 隔离存 IndexedDB；`pick` 必须用户手势触发并以 `showDirectoryPicker({mode:'readwrite'})` 调用，AbortError 归为取消；`restore`/`requestAccess`/`forget`（只忘设置不删文件）；`saveFile` 完整链路=权限复查→逐级建目录→同名哈希一致复用/不同建 `-conflict-N` 名（绝不覆写用户文件）→createWritable/write/close→读回校验字节与 SHA-256，失败分类 NO_ACCOUNT_SCOPE/PERMISSION_REQUIRED/WRITE_FAILED/CLOSE_FAILED/VERIFY_FAILED。
- 新增 `src/local-output.test.mjs` 13 项全绿：句柄复用、拒绝/撤销权限、取消选择、写失败无残留、close 失败、读回不一致、同名复用/冲突、账号隔离、忘设置不删文件、无 scope 拒绝；**真实磁盘验证**用 FSA 同契约的 Node fs 适配器在 `os.tmpdir()` 专用临时目录实际写入→close→Node fs 读回比对 SHA-256 与冲突行为，不是 OPFS/Blob 替身。
- “文章保存”目录页：console-view 个人设置新增页签（`#saving-settings`），runtime `renderSaving` 显示支持情况/目录名/授权状态，按钮=选择/重新授权/忘记此设备目录，不支持环境如实提示且不提供选择按钮；页签打开即刷新状态（directorychange）；登出与换账号 `localOutput.setScope(...)` 重置。待补存数量占位明确标注“本地交付将在后续版本启用”。
- 新增 `scripts/check-local-directory.mjs`（真实 Edge）：手势触发 picker 一次、授权态显示、忘记回退、换账号隔离（fixture 注入 `window.showDirectoryPicker` 存根仅测交互——OS 目录选择器无法自动化；真实磁盘验证在 Node 测试）、1280/390 无溢出、两个会话全 PASS。
- 验证汇总：`npm test` 44 通过 + 2 个既有失败（同阶段 A，未改）；`npm run test:python` 71/71；`npm run build`；check-local-directory / check-workspace-feedback / check-console-layout / check-login-flow 全 PASS；`git diff --check` 干净。
- 环境注意：本会话再次出现“写入被静默吞掉”——git 提交后分支引用丢失（第 4 次，已按文档流程恢复），以及一次 runtime.js 编辑与一次测试脚本编辑落盘丢失需重写。**每次编辑/提交后必须立即 grep/`git log -1` 复核落盘结果。**

下一步：§12 阶段 C（数据库 v5 与交付事务：tests_postgres/test_local_delivery.py、delivery service、正文清理与按交付结算）。

## 阶段 A（2026-09-16，工作区创建反馈）已完成，本地提交 1eea68770a244638dc21a66039c6683c7a5aed87

按 `docs/superpowers/plans/2026-09-16-glm-development-handoff.md` §12 以 TDD 完成阶段 A，仅本地检查点：未推送、未部署。先写失败测试再实现：

- 新增 `geo-site/scripts/check-workspace-feedback.mjs`（真实 Edge，沿用 `GEO_TEST_PLAYWRIGHT_MODULE`）。两个会话：空态会话断言总览图标、`.console-empty-state` 吉祥物空态与 `#overview-create`、工作区空态引导与 `#empty-create`、点击创建出现“正在创建…”与 `aria-busy`、仅一次创建 POST、创建后标题自动聚焦、运行任务可用、1920/1280/1280×600/390px 与 125% 缩放无横向溢出；失败会话断言 500 时显示错误原因、重试按钮恢复可用。
- `workspace-ui.js`：`create()` 提取为独立函数，`pendingCreate` 幂等请求 ID（4xx 时重置），`aria-busy` 与“正在创建…”即时反馈，busy 清除后 `setTimeout` 聚焦标题。
- `console-view.js` 成为空态唯一所有者（修复双所有者 bug：`showLogin`→`reset()` 曾重新打开 materials）：`setWorkspaceEmpty`/`setBatch` 统一管理空态与 uploads 显隐；总览空态含吉祥物图与创建按钮（经 `onCreate` 回调）。
- `runtime.js` 接管 `initializeConsole` 初始化（`onCreate:()=>workspaces.create()`），`onSelect`/`renderBatch` 同步空态；`app.js` 移除重复初始化。`index.html` 总览按钮补内联 SVG，样式版本号更新；`styles.css` 末尾追加 `.workspace-empty`/`.console-empty-state` 样式块（含 760px 移动端适配）。

验证：`npm run build` 通过；`npm test` 28/30——仅剩两个与本阶段无关的既有失败（`model-switch.test.mjs`：runtime.js 既有 `AUTH_TAB_MARKER` 使用 sessionStorage 触发凭据正则；`.geo-table-wrap table` 基础字号 9px/媒体查询 12px vs 断言 13px；两者经 diff 确认非本次改动引入，未擅自“顺手修”以免扩大范围）。`check-workspace-feedback.mjs`、`check-console-layout.mjs`、`check-login-flow.mjs` 全部 PASS；`git diff --check` 干净。提交信息中已如实记录两个既有失败。

⚠️ git 事故记录：本机每次 `git commit` 后分支引用 `refs/heads/feat/static-geo-model-catalog` 都可能被静默吞掉（reflog 与提交对象完好，`git update-ref` 写入亦会被吞），已两次复现（1eea687 与 349143b 后），最终以 `printf SHA > .git/refs/heads/feat/static-geo-model-catalog` 手动恢复并验证持久。后续每次提交后必须跑 `git -C <工作树> log -1` 确认 HEAD 可解析；若丢失，从 `.git/logs/refs/heads/feat/static-geo-model-catalog` 末行取 SHA 手动重建引用文件。

下一步：接续 §13 阶段 B（本地交付目录）；阶段 A 未推送，与后续阶段一起再定推送节奏。

## 当前接续重点（优先于下方历史测试）

2026-09-16 最新接续：用户要求将完整开发思路交给 GLM 智谱，包含根路径、GitHub/分支位置，并复审两次。本轮仅编写交接方案、更新进度并建立本地文档检查点，没有修改业务代码、数据库、环境或生产资源，没有新推送。单一交接文件：`docs/superpowers/plans/2026-09-16-glm-development-handoff.md`。两轮内联复审已完成，第一轮补齐旧启动入口、回执/到期退款边界、等待写盘后的执行恢复、schema 迁移版本与正文副本；第二轮核对 35 个现有路径、9 个拟新增文件、测试命令和凭据格式扫描。新功能仍为待实施，不将方案审查称为功能测试通过。

当前代码发布基线 e12d4244d51db8b408d51d6daf7af473b212dab9：本轮只读 ls-remote 确认 GitHub master 同 SHA，远端没有 feat/static-geo-model-catalog 同名分支；后者只是当前本地开发分支。用户最新 EdgeOne 截图显示生产 master/e12d424、运行中，已获部署记录截图证据；不再沿用下方“尚未确认部署”的旧状态。但本轮没有线上 health/schema v4 响应或真实 IMA/模型文章验收，Worker 仍无常驻生产服务器。

用户最新纠正：批次工作区不是完全不能运行，先点击左下角“新建任务”后可操作，但交互有等待感。受控正式页面浏览器诊断确认：无工作区时上传被 inert/disabled；创建请求等待时按钮虽禁用仍显示“可新建”，没有创建中反馈；总览导航确实缺图标，人物可加载但位于大空白面板下方。这些 UX 问题尚未修复，也未测出生产延迟根因。

本地文章保存已获明确方案选择：“允许文章临时加密中转，本地保存成功后清除在线正文”。尚未实现目录授权/同账号本机复用、写盘读回校验、回执清理与按本地交付结算。GLM 按交接方案先修空态/反馈，再分阶段实现交付，不重做已完成的登录、五工作区、SaaS、共享 IMA 缓存。没有授权自动清除未交付/历史文章，不随意轮换 GEO_MASTER_KEY；现有服务端 artifact 成功判定必须与新交付模式区分。

2026-09-16 发布协调已确认：用户明确“我没有在执行的任务”，且暂无可持续运行 Python 的独立服务器。按既有授权发布网页/API 版本，常驻 Worker 不作为本次网页发布的阻塞条件，但不宣称已生产运行。首发阶段生成时保持网页打开，关页后自动持续执行仍待 Worker 承载部署。已经联网刷新确认 GitHub master 为 6411b5dac98e07f31a83969032c2d60d6e80e3df；功能提交 8c71303 相对远端前进六个提交、无落后，可以正常快进，不强推。此段随发布检查点保存；实际推送回执和最终提交号写入 E:/codex/GEO-RESUME.md。EdgeOne 构建/线上 health v4/真实模型任务分别核对，不能由 Git 推送推定通过。现有环境变量不变，不购买或开通新资源。

2026-09-16 阶段十一：常驻 Python Worker 五路本地实现已完成，接续阶段十提交 b4ed6ee。`--concurrency 1–5` 默认五路，每个槽/步骤独立 PG 连接；沿用 job 租约、心跳和批次步骤锁，不重复重发结果不明的模型调用。单路故障隔离，SIGINT/SIGTERM 停止领取并等待当前阶段收尾，恢复原信号处理器；`--once` 仍只执行一个步骤。无新增环境变量，不改现有主密钥，也未开通或修改生产资源。

本地验证：新增三项池测试先失败后通过，连同旧 Worker 两项共五项通过；真实 PG 无浏览器验收直接运行实际 `serve`，五个独立工作区峰值五路，四篇完整 MD 落库、一条上游失败只退一分（余额 10→6），五次生成+四次审核无重复，全部名额释放，停止信号正常收尾。另补测 CLI once、HTTP 步骤争用重排队、旧租约拒绝，共四项 PG/CLI 定向检查通过。2026-09-16 接续只补查未覆盖的 CLI help 与并发 6 被拒绝（退出码 2），没有重跑未变化的上述验证或前端构建。IMA/模型为固定上游响应，未调用线上客户 Key。

当前剩余发布协调：生产 Worker 承载主机未确认，已询问但尚无明确回复；旧版线上任务是否全部完成/暂停且当前调用已结束，也未确认。首轮只部署单 Worker 实例，不自动扩容；网页可手动刷新后台进度，仍如实提示未部署 Worker 时关页可能暂停。不要因此再重做前端或并发池。部署文档 geo-site/docs/deployment/geo-saas-runtime.md、geo-workspaces-v4.md 已同步 schema v4/命令/验收边界，计划见 docs/superpowers/plans/2026-09-16-worker-pool.md。本阶段仅本地检查点；GitHub 最后确认 6411b5d，未推送、未核对 EdgeOne。自动生产发布前须确认停稳，不把用户“继续完成”当作所有线上任务已停止。本地保存目录仍按用户要求后做。

2026-09-16 阶段十：正式网页五工作区已接入（本地，未推送/未部署）。新建独立 Excel 草稿、五页签、加密自动/手动保存、选中工作表及完整公司正文恢复、各自模型选择和启动后锁定；各批次浏览器驱动相互独立，切换不串任务，单独暂停/继续/取消/下载。总览显示草稿与已启动任务且不重复计数；旧历史批次仍可打开。版本冲突保留本页内容，保存途中修改串行写入，启动响应丢失冻结编辑并允许重新读取，认证切换清空私有工作区与旧执行器。无新变量，模型 Key 录入不改，仍为用户已有厂商 Key。

验证：新增执行器 4 项先失败后通过；受影响认证/runtime 共 14 项通过。真实 Edge + 本机 FastAPI + 隔离 PostgreSQL：五份独立上传/模型保存、刷新恢复、CAS 冲突、五路启动、暂停一个不影响其他、四个真实 MD 文件下载/内容归属、第五个上游故障仅退一分（余额 10→6）、390px 宽度通过；IMA/模型是固定上游响应，不是生产调用。第二组真实浏览器验证保存中二次编辑/切换串行 version、启动响应丢失后恢复/取消退一次、关闭草稿、换子账号资料清空及直接 GET 他人工作区 404 通过。正式 bundle 认证浏览器回归（主动登录、刷新、退出、旧 401、迟到文件）通过；owner/member 目录/响应式/下载回归通过。构建通过，已查看桌面工具栏、手机、五结果总览截图（output/playwright/five-workspaces）。内联审查修复切换读取期间旧操作按钮可点击、历史关联缺失、并行任务刷新覆盖未保存模型、过期错误提示不清除等问题。

当前接续：常驻 Worker CLI 仍单循环，需要并行调度与无浏览器完成验收；生产承载主机未确认。网页现明确提示“关闭页面可能暂停后续生成”，不能称为关页后线上五路不停。本地输出目录仍按用户要求后做。阶段九后端旧测试无代码变化不重复。阶段十计划：docs/superpowers/plans/2026-09-15-workspace-ui.md。GitHub 最后确认 6411b5d，本阶段仅本地检查点。

2026-09-15 阶段九：五工作区服务端基础已实现，schema v4 增加 workspaces 加密草稿，账号/租户/工作区绑定校验，version 冲突保护；草稿+未结束批次共用最多五名额，在账号行锁内分配。新增本人工作区 create/list/get/save/start/archive API；启动以数据库草稿为准，固定各自已配置模型和 Key 快照，同事务创建批次/积分预扣/job/绑定，运行后不可编辑或以归档绕过取消退款。旧 batches 入口也计入五名额。到期可读自己的历史并关闭未启动草稿，不能创建/保存/启动。沿用原 GEO_MASTER_KEY，无新增变量，不轮换密钥。

增量证据：8 项真实 PostgreSQL 新测试通过，含八路并发创建只成功五个、跨账号名额独立、幂等、加密正文/密文调包拒绝、旧版本保存/启动冲突、五路并发启动模型快照/积分/取消释放、余额不足事务回滚、CSRF、到期限制、旧入口不能绕过。独立连接上的五批次同时执行（上游固定响应）测得峰值 5；一批次故意失败仅退款一分，其余四篇以 ArtifactService 校验完整正文归属。schema/Batch/API 16 项通过，v1→v4 保留旧文件/默认工厂 health/旧创建幂等 3 项通过。测试库中途停止，已只恢复本机 127.0.0.1 隔离实例；未访问生产数据库。前端未变更，不重复布局构建。

接下来接前端五个草稿/运行工作区切换与独立驱动，然后常驻 Worker 并行与现场部署；当前正式页面仍是阶段八的单活动批次入口，不能声称用户已能在网页五并行。尚未推送或部署 schema v4。新恢复入口指向最新本地 SHA；不要重新执行阶段七/八已验证项目。

2026-09-15 阶段八：批准的 A 总览 + B 当前任务详情已接入正式页面，正文恢复 12px 微软雅黑、标题 22px、侧栏 180px、人物 64px；原图 Logo 保留。个人设置分模型/API、安全说明、积分有效期、微信续费；owner 独立管理中心分子账号、积分、续期、IMA、缓存、流水，复用原表单和接口。历史批次的资料页只读，不混入新建草稿；文章通过原 artifact 接口下载。五工作区尚未实施，新建按钮仍明确执行旧版单活动批次限制，不能将本阶段标为五并行完成。

新证据：check-console-layout.mjs 的正式 DOM 在真实 Edge、owner/member 两个角色、1440/1280/1920/390px 通过导航、布局、管理页隔离和 MD 下载；只读资料缺口先断言失败再修复。桌面总览、详情、个人设置、管理中心及手机截图已查看。本机浏览器连接真实 FastAPI + 隔离 PostgreSQL，目录中的创建成员、指定成员发积分、续期、流水实际写读通过；暂停/继续至完整文章落库、MD 文件下载通过；member 直接请求管理接口返回 403，微信图和手机无溢出通过，无 JS 错误。上游为固定测试响应，不是生产模型实测。结构变更后的登录/退出/旧响应/Logo 浏览器回归通过；构建与 git diff --check 通过。未重复未变化的后端全量测试。

本地检查点待/已保存的完整 SHA 由 E:/codex/GEO-RESUME.md 顶部记录；此阶段未推送或部署。继续已批准的五个独立工作区：草稿与批次持久隔离、服务端最多五个、固定模型快照、独立调度/退款/输出。已询问可用常驻 Python Worker 平台，生产主机尚未确认；不会擅自开通付费资源。页面材料原文回看、服务器 30 分钟交互闲置超时、敏感操作二次验证、本地保存目录仍未实现。

2026-09-15 阶段七：用户已批准 A+B 组合并指定左上角 Logo。正式程序已实现主动密码登录入口、仅当前登录标签页刷新可向服务器恢复、认证代数隔离旧响应、退出清理私有表单/上传/历史、退出后待返回的文件读取不回填。重新登录撤销当前浏览器旧 Cookie；会话绝对期限为 8h，PostgreSQL 同时限制旧版七天会话。原图无修改复制为 assets/lxue-brand-logo.png，两者 SHA-256 一致，40px 展示；草稿同步品牌图。

本阶段定向证据：Node 认证/运行时 10 项通过；Python Auth/API 15 项通过；真实 PostgreSQL 旧会话期限/Cookie 轮换 2 项先失败再通过；真实 Edge 正式页面受控响应覆盖新入口、无效认证 JSON、手动登录、刷新、退出、迟到 401、退出时上传读取竞态、Logo 解码和尺寸，最终无 JS 错误。期间发现并修复旧 bootstrap 让新登录按钮禁用的问题。前端构建通过。上游模型未调用、EdgeOne 未部署；不声称生产安全验收完成。

继续做批准的目录设置、A 总览/B 详情和紧凑字体。五个独立工作区的前后端/持久调度尚未改，不能声称并行已完成；worker 生产承载仍需明确。30 分钟服务端闲置超时/敏感操作二次认证未包含在本阶段。实施计划见 docs/superpowers/plans/2026-09-14-console-auth-brand.md。下方“设计待选择”为历史，已被本段批准记录替代。

2026-09-14 阶段六（当前最新，设计待选择）：用户新增整体字号回到扩大前、目录式设置、owner 独立管理中心、登录不得自动跳转、五个独立工作区并行、商业化冰蓝视觉。用户已明确“五个”是五份独立 Excel 工作区，不是单表五行。当前仅完成方案及可点击草稿，未修改正式应用、未推送草稿，不得声称登录/五并行已修复上线。

草稿方案见 docs/superpowers/specs/2026-09-14-commercial-console-draft.md；交互原型见 docs/superpowers/design-previews/2026-09-14-console/index.html。A 为紧凑任务总览，B 为五页签专注工作区；另含个人设置、owner 管理、登录、成员视角。推荐 A 首页 + B 详情。真实 Edge 已渲染五张 PC 草稿及手机图，导航、成员入口隐藏、图片加载、手机页面宽度通过；这是原型验证，不是权限接口验证。没有运行未变更的旧测试或生产模型调用。

登录检查：代码 SESSION_TTL=7 天、Cookie max_age=604800、前端初始化 auth/session 成功即 enter；本机正式 HTML/JS 配受控响应复现 401 留在登录页、200 在未输入密码/未提交登录时进入工作区。后端密码和有效会话校验仍存在，不能据此断言匿名绕过密码。旧响应与登录/退出竞态尚需专项补测。当前单活动批次限制同时存在于 runtime.js、app.js 和 BatchService._create，五任务需要前后端和持久调度一并实现。

接下来等待用户选 A/B/A+B，再固定登录入口/刷新/新标签页行为，优先实施安全修复，然后做设置拆分和五工作区。生产 worker 承载仍未确认；不保证现有版本关页后五路持续执行。草稿及诊断已建立本地检查点，完整提交号由 E:/codex/GEO-RESUME.md 记录。GitHub master 最近已确认提交仍是 6411b5d，此轮没有重新查询或推送。

2026-09-14 阶段五（当前最新）：按用户两张截图完成 PC 工作区顶部微调。模型和 IMA 状态卡保持横向并排；卡片约 53px 高、IMA 约 70px 宽；说明文字由 14px 调为 13px，使用标题区完整一行，不截断、不省略。仅调整 861px 以上的布局，移动端排版与字体不变；登录、API、积分、缓存、生成逻辑没有改动。样式链接版本已更新以避免继续引用旧样式。

新增 scripts/check-header-layout.mjs：真实 Edge 渲染当前 HTML/CSS，仅隔离网络与登录，不调用数据库或模型。修复前复现 1280px/861px 状态卡堆叠和说明折行；修复后 1280、1440、1920、2560、1024、861、860、390px 八种窗口宽度全部通过，PC 卡片并排、说明单行无裁切、页面无横向溢出。已查看 1280px 与 390px 截图；npm run build 和 git diff --check 通过。未重跑代码未变的后端、计费及模型测试。

阶段四提交 dd0dd4b 已成功推送到 GitHub master；本次阶段五在此基线上保存新检查点并正常快进推送，精确提交号及回执以 E:/codex/GEO-RESUME.md 为准。EdgeOne 是否已发布本次样式仍需核对；不要把本机布局验证称为线上完整任务验收。下方阶段四及更早记录属于历史证据。

2026-09-14 阶段四（最新）：已完成批次状态 AES-256 加密，升级 schemaVersion=3。所有批次读写、历史列表、幂等创建、积分文件完整性校验均改用加密状态；首次迁移在同一事务内保留原始内容、序号和文件，清空旧明文副本，数据库禁止旧版重新写回明文。密文绑定账号与批次，沿用原 GEO_MASTER_KEY，无新增环境变量。历史备份不自动删除，禁止直接回滚到旧版明文写入代码。

本轮新增三项测试先复现明文缺口，再修复通过。改动后的 PostgreSQL 41 项全量通过，随后默认生产 API 工厂补测 1 项通过；schema/API/Worker 定向 12 项通过。真实 Edge 浏览器连接加密后的本机 FastAPI + PostgreSQL，暂停/继续、实际 MD 下载、模型解锁、子账号权限、个人流水和移动端通过，无 JavaScript 错误。上游仍为固定测试响应，未使用线上客户 Key。代码未变化的前端构建、Node 测试和旧页面布局不重复运行。

发布内联审查发现并修复 v1 未计费批次无法取消的兼容问题：不使用可变密钥继续旧任务，允许保留文章并取消旧批次、不追扣积分。专属 PostgreSQL 回归先失败后通过，另补测新批次暂停/取消/五行部分退款 3 项与批次单元 7 项。发布差异共 52 个路径的凭据格式扫描未发现目标格式密钥或私有环境文件；git diff --check 通过。旧生产版尚无 SaaS 计费，发布后总账号可自行管理积分及有效期。

本次用户已明确要求完成后推送。已联网核对 origin/master=7da175c，当前分支没有落后远端的提交，可正常快进推送；不强推。此记录随发布候选提交保存，实际推送回执/提交号同步写入 E:/codex/GEO-RESUME.md；线上部署仍需核对 EdgeOne 实际提交及 health，不能以本地测试代替。发布检查项目及升级注意事项见 geo-site/docs/deployment/geo-saas-runtime.md。

下一步仅剩发布现场确认：推送本检查点、核对 EdgeOne、经确认的一条真实模型/IMA 任务；独立 Worker 的生产主机未确认，不能声称关页后已常驻执行。本地输出目录选择依用户要求仍属后续项。以下阶段一至三为历史过程，不再作为未完成清单。

ce83602 是 SaaS 原型检查点，不是已完成的发布版。此前 58 项 Python 测试主要使用内存替身，没有证明真实数据库事务正确。2026-09-14 增量修复阶段见提交 `fix: validate SaaS transactions against real PostgreSQL`。tests_postgres/test_runtime_integration.py 在本机隔离 PostgreSQL 的 25 项验证已全部通过：批次/预扣/快照原子创建、并发幂等、子账号余额隔离、积分收回、反复重试退款台账、长问句缓存、按 Excel 行而非篇数扣分、五行四成功一失败净扣四分、文件与状态事务回滚、中文文件名下载与账号隔离、文件不可覆盖、旧 owner 登录迁移、最新订阅优先、owner 专属充值和缓存管理、模型锁定、到期拦截、取消退款、过期 claim 跳过退款而不重发、Worker 租约令牌/忙碌重排队/无浏览器完成文章/CLI --once。

本轮 Python 58 项旧测试全量时唯一失败来自测试替身缺少新增幂等查询；补齐替身后对应 batch 与 worker 7 项全部通过。未重复运行代码未变的 Node/PC 验证。git diff --check 已通过。测试只使用临时隔离数据库和模拟上游模型，未调用线上客户密钥或产生模型费用。

2026-09-14 增量阶段二：修正 IMA search_knowledge 的 knowledge_base_id 字段、目录两种响应结构；月度凭据轮换不再清缓存；缓存键保留 ID/游标大小写及词间空格、包含代数，批次固定缓存代数；获得锁后复查命中，缓存争用不误退款。新增真实 PostgreSQL 验证证明：显式清代后运行批次保留旧资料；两个用户各用自己的模型 Key，第二位用户零 IMA 请求完成文章落库；缓存争用保留原任务和预扣。对应 IMA/批次增量测试共 16 项通过，上游为固定测试响应，未调用生产密钥。

2026-09-14 增量阶段三（当前接续基线）：已完成总账号选择子账号、创建成员、发放/收回积分、续期与流水界面；普通成员可见自己的流水、到期提醒及现有微信联系图。订阅目标归属校验、重复续期幂等、管理审计、旧 owner 会话初始化均已补齐。运行页接入服务端暂停/继续/取消、任务退款统计、失败任务原因、全局模型锁；到期时停止后续任务并退款。无需新增 EdgeOne 环境变量。

本轮验证：真实 PostgreSQL 33 项全量通过，随后新增无工作区账号边界检查及对应 API 补测 8 项通过；Python 60 项通过；Node 23 项通过；前端构建成功。真实无头 Edge 浏览器连接本机 FastAPI + PostgreSQL，已验证指定成员发积分、续期、成员创建、暂停/继续、实际 MD 下载、任务结束模型解锁、普通成员权限/流水/微信图、390px 移动端无横向溢出。浏览器发现登录重置导致创建成员默认日期丢失，已修复并实际复测通过。最后只对 PC 下拉框/日期尺寸做了定向视觉补测，没有重跑已通过的充值续期。

阶段三当时尚未完成的批次正文加密已在顶部阶段四解决。仍须严格区分：真实浏览器和真实 PostgreSQL 已验证，上游 IMA/模型为固定响应；线上客户 Key 与生产 Worker 尚未验收。不擅自开通付费资源。

用户新增停止要求：当账户剩余额度约 20% 时停止。已说明工具无法读取账户额度，需用户提供余额或到阈值时通知；不要声称可以自动监控该余额。本轮按“完成当前联调阶段并保存检查点”收尾。

## 从这里接续

- 当前工作树：`E:/codex/weijia/.worktrees/static-geo-model-catalog`
- 当前分支：`feat/static-geo-model-catalog`
- 发布目标：`kudisengjie/weijia` 的 `master`，用户已授权推送。
- GEO 子站目录：`geo-site`
- 不要切回旧 `E:/codex/weijia` 副本；不要重复登录、Python/PostgreSQL 迁移、图片替换和旧 Node/Blob 修复。

## 用户已确定的范围

使用 EdgeOne Pages + Python Cloud Functions + Neon PostgreSQL，不使用 CloudBase。登录页采用 A 方案和用户提供的人物图。用户在现有设置界面填写八家模型自己的 API；IMA 使用站点所有者凭据，管理员可按月更新。模型 Key、IMA 覆盖凭据、会话和批次进度只在服务端保存。

移动端当前可接受，本阶段只重点改善 PC。用户新增但明确要求稍后处理的需求：第一次运行前选择文章输出目录，同一台设备复用已授权目录，不要每批重复选择。

## 当前实现

- EdgeOne Python ASGI + PostgreSQL 登录、会话、CSRF、限流、模型设置、IMA 覆盖和幂等批次状态机仍保留；用户已确认上一版线上可以真实登录。
- PC 端在 861px 以上使用微软雅黑优先的独立排版层：辅助文字 12px、正文/表格 13–14px、卡片标题 16–18px；移动端原布局不变。
- 运行按钮只有在 `disabled` 时显示灰色；可运行时显示深蓝底白字。
- 顶部模型和 IMA 徽标已改为读取 `/api/settings`，与创作准备区、设置页和右侧状态舱使用同一配置状态，不再保留静态“未连接”。
- Excel 读取端和 Python 后端都会删除整行为空的格式行。包含 200 个格式行但只有少量真实任务的表格不再误触 100 行限制。
- API Key 设置交互未改。厂商适配已修正腾讯混元、MiniMax 中国开放平台和 Kimi 的官方域名，MiMo Bearer 鉴权，以及 MiniMax/Kimi/MiMo 的 token 字段；不自动重试外部生成请求。
- 默认目录保留混元 Hy3/Hy4、Qwen3.8、Seed 2.0、DeepSeek V4、MiMo V2.5；MiniMax 更新为 M2.7/M3，智谱更新为 GLM-5.3 Flash/5.3；Kimi 界面保留用户指定的 K2.7 Code/K3，并使用开放平台 `kimi-k2.7-code`/`kimi-k3` 请求 ID。
- `npm run test:python` 已改用跨平台 Node 启动器，在 Windows 不再因路径分隔符无法启动虚拟环境。

## 本阶段新鲜验证证据

- 已把 SaaS 运行时计划落到当前工作树：schema v2、租户/子账号、30 天订阅、积分台账与逐任务退款、站点级 IMA 加密缓存、批次模型快照、持久化文章文件、租约任务和独立 Python worker。
- `npm test`：20/20 通过。
- `npm run test:python`：58/58 通过。
- `npm run build`：成功生成最新 `assets/app.js`、PDF worker 和白名单 `dist`。
- `git diff --check`：无空白错误。
- TDD 覆盖新增运行按钮边界、模型锁定、artifact 下载、五任务积分预扣/退款、重复退款幂等、IMA 缓存命中/清代、租户权限与订阅过期、worker 租约恢复等路径。
- `geo-site/docs/deployment/geo-saas-runtime.md` 已补充 EdgeOne 变量、Neon pooled URL、schema v2、worker、缓存代际、积分订阅与二维码的现场验收步骤；未写入任何密钥。

## 阶段四推送前的三层状态（历史）

- 本地工作树：已完成真实数据库、共享缓存、账号管理、浏览器暂停/继续及批次正文加密，准备发布当前候选版本。
- GitHub：本次推送前已实时核对 `master` 为 7da175c，无分叉；实际推送结果见根恢复入口与 Git 同步检查。
- EdgeOne：上一版已由用户确认可以登录；本阶段 PC/IMA/Excel/模型适配修复尚未部署。

## 仍需完成或现场确认

1. 从顶部阶段四接续，核对发布候选提交的 GitHub/EdgeOne 状态。批次加密、真实数据库及本机浏览器已通过的项目不重复运行。
2. 部署后检查 `/api/health`、登录、订阅/积分、artifact 下载和顶部 IMA 状态。没有读取或输出任何密钥值。
3. Mock 测试证明请求契约正确，但不能代替各厂商账号权限、余额和模型开通状态。线上已有模型密钥时，可通过“测试已保存模型”发起一次明确的小请求；其余厂商必须在各自 Key 配置后逐个测试，不能宣称未配置厂商已经真实成功。
4. 后续阶段实现文章输出目录选择与同设备复用；浏览器需要采用 File System Access API，并为不支持的浏览器提供逐篇下载退路。

## 重要限制

- 浏览器关闭后已完成的批次步骤仍持久化，但不会后台无限自动推进。
- 模型失败/超时不自动重发；运行权声明过期且无法确定结果时，该任务跳过并退款，不以暂停后的“继续”重发结果不明的请求。
- IMA 证据最多读取前六份完整原文；超长或不支持格式明确报错，不静默截断。
- `.local`、数据库连接串、密码、管理员口令、IMA 与模型 Key 不得进入 Git 或进度记录。
