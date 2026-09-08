# 零雪 GEO · EdgeOne 运行版部署

官网主站继续用原项目。GEO 子站使用同一仓库的 `geo-site` 目录，不能把仓库根目录作为 GEO 发布目录。

## EdgeOne 项目配置

| 项目 | 值 |
| --- | --- |
| GitHub | `kudisengjie/weijia` |
| 发布分支 | `master` |
| 根目录 | `geo-site` |
| 框架 | Other / 自定义 |
| 安装命令 | `npm ci` |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| 构建 Node | 22.17.1 或 24.5.0（浏览器 PDF 依赖要求）；函数仍为 Node 20 |
| Node Functions | 启用；`cloud-functions/api/[[path]].js` |
| Blob | 使用 Pages Blob；SDK 首次调用自动创建 `lxue-geo-private` 命名空间，不需要手动创建同名存储空间 |

`edgeone.json` 已设置函数最长 120 秒，以及需保留的 Node 依赖。公开 `dist` 只包含 HTML、CSS、图片和浏览器 bundle；函数由 EdgeOne 单独打包，**不要把 `.local`、`server`、环境配置或整个项目目录直接作为静态产物上传**。

## 服务端环境变量

在 GEO 项目的服务端环境变量中配置以下值，不设置任何 `VITE_` / `PUBLIC_` 前缀：

| 变量名 | 用途 |
| --- | --- |
| `APP_ORIGIN` | 正式地址，固定 `https://geo.lxue.xin`；必须与浏览器入口一致，不带末尾斜线 |
| `GEO_ACCOUNT` | 用户指定的登录账号 |
| `GEO_PASSWORD_HASH` | scrypt 加盐密码哈希，不是明文密码 |
| `GEO_MASTER_KEY` | 64 位十六进制加密根密钥；不可随意更换，否则已有私有数据无法解密 |
| `IMA_ADMIN_SECRET` | 独立管理员更新口令，仅站点所有者持有，不与普通登录密码共用 |
| `IMA_OPENAPI_CLIENTID` | 站点所有者 IMA Client ID |
| `IMA_OPENAPI_APIKEY` | 站点所有者当前 IMA API Key |

初始值已在开发电脑生成于 **`geo-site/.local/edgeone-secrets.json`**。该文件已被 Git 忽略，不含明文登录密码。仅将其各字段复制到 EdgeOne 控制台对应环境变量；**不要上传此 JSON、不要发到聊天、不要写进仓库**。Windows 环境变量不会自动出现在 EdgeOne 云端。

禁止在生产环境设置 `GEO_LOCAL_DEV=1`。本地服务自动使用该值以允许 HTTP localhost Cookie；正式站点必须使用 HTTPS Secure Cookie。

### 控制台操作与存储报错

1. 进入绑定 `geo.lxue.xin` 的 GEO 子站项目 → 项目设置，按上表设置根目录、构建和输出目录，不改官网主站项目。
2. 在环境变量中逐项添加上述 7 个变量，值从本地私有配置的同名字段复制；界面中的值不包含 JSON 外层引号。不要重新生成已有加密根密钥。
3. 保存后，在部署记录中重新部署生产分支 `master`。环境变量变更只作用于新部署，刷新网页不能替代重新部署。
4. Blob 官方 SDK 在托管函数中自动获取部署凭据，首次调用创建命名空间；并非必须先找到一个“启用 Blob”开关。不要把 IMA Key 填成 Blob 凭据。
5. 如果仍提示 `STORAGE_UNAVAILABLE`，打开此次部署的函数日志，核对 Node 函数依赖是否安装、Blob SDK 是否取得平台部署凭据，以及当前项目是否支持 Blob。页面这条通用错误来自存储初始化阶段，不代表账号或密码错误，也不能单凭它断言“未启用 Blob”。如控制台没有 Blob 入口，先确认当前账号/项目的功能支持，不要盲目购买 CloudBase。

给开发者提供函数错误类型和部署设置截图即可；遮住 Token、密码哈希、加密根密钥和 IMA 凭据。目前入口未输出底层初始化异常，若平台日志没有原因，需再加入脱敏诊断，不能猜测根因。

官方依据：[项目构建与环境变量](https://edgeone.cloud.tencent.com/pages/document/162936788693114880)、[Blob 自动创建与托管凭据](https://pages.edgeone.ai/zh/document/blob-storage)。

## 每月更新 IMA

登录 → 设置 → 共享 IMA 知识库 → 管理员更新：填写独立管理员口令、新 Client ID、新 API Key、到期日期。服务端确认新凭据能访问 `copilot` 后加密替换；失败保留旧凭据。保存后下一次请求立即使用，无须重新推送或重新部署。已有 Blob 覆盖值优先于初始环境变量。

## 用户使用

1. 用授权账号登录，设置中选厂商/模型并填写自己该厂商的 Key。可填实际开通的模型 ID，不接受任意代理 URL。
2. 保存设置后，可主动点击真实模型测试；“已配置”仅表示存在 Key，不代表已通过真实请求。
3. 上传任务表（标题：品牌名、GEO知识库、问句；可选篇数、媒体平台、AI平台、备注），上传公司文档，并为每份文档填写品牌名。
4. 创建批次后固定模型，依次读取 IMA 规则/证据、生成、审核，必要时修订一次。每一步保存进度；只导出审核通过的 MD。
5. 失败或超时不会自动重发模型请求。历史中可继续；超过 150 秒仍未结束时，可明确选择恢复超时步骤。上次超时请求可能已被提供商计费。

同一共享登录账号下，每次登录采用独立会话隔离，避免不同使用者覆盖彼此 Key。会话 7 天有效，退出/重新登录后无法访问旧会话私有数据。请先下载文章；本版**不是跨登录账号云盘**。如要跨登录保留，应先为每位使用者建立独立身份，不能简单将共享账号下所有 Key 合并。

关页暂停后续步骤；不是后台无限运行任务。IMA 最多使用检索排名前六份完整原文；正文超过安全大小会明确报错。原生联网搜索未启用。仓库中的模型目录来自已确认版本，具体可调用模型取决于用户提供商账户。

## 验收与费用边界

- 仓库自动测试使用模拟模型/IMA 响应覆盖业务与安全；不是八家模型真实测试。
- 本次开发已进行一次 IMA 真实只读测试，确认 `copilot` 可见。
- 正式环境需确认：未登录 API 为 401；登录成功；模型 Key 保存后不回显；用户主动真实测试；小批次生成与下载。
- 不使用 CloudBase。EdgeOne Functions / Blob 和模型服务仍有额度及套餐限制，不能承诺永久免费。管理员需按项目用量管理旧会话存储。

官方说明：[Node Functions](https://pages.edgeone.ai/document/node-functions)、[Blob 存储](https://pages.edgeone.ai/document/blob-storage)、[函数时限与打包配置](https://pages.edgeone.ai/document/edgeone-json)。
