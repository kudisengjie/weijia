# 官网全面修复计划 — 编码损坏 + i18n失效 + 移动端适配

## 一、问题根因分析

### 致命错误：PowerShell批量替换破坏了UTF-8多字节中文字符

在之前的"编码修复"操作中，使用了以下PowerShell命令：
```powershell
$c = $c -replace '\ufffd\?', '？'
```

这个正则表达式不仅匹配了真正的乱码字符（U+FFFD），还**误匹配了合法UTF-8中文多字节序列中的部分字节片段**，导致大量正常中文字符被替换为`？`。

### 损坏范围统计

| 文件 | 损坏类型 | 具体表现 |
|------|---------|---------|
| **i18n.js** | **JS语法错误+文字损坏** | 字符串缺少闭合引号 → 整个翻译系统崩溃 |
| index.html | 文字截断 | `研发`→`研`, `优化`→`优？`, `运营`→`运？` |
| profile.html | 文字截断 | `研发`→`研`, `引力场`→`引力？`, `吕炜佳`→`吕炜？` |
| insights.html | 大量乱码 | `2026年6月`→`2026？？6`(38处), `技术`→`技？`, `内容`→`内？` |
| blog/index.html | 文字截断 | 类似模式 |
| geo-guide.html | 文字截断 | 类似模式 |
| brand-facts.html | 文字截断 | 类似模式 |
| support.html | 导航栏泄漏 | `<head>`标签断裂导致meta内容泄露到页面(已修复但可能不彻底) |

### 5个用户反馈问题对应关系

| 截图 | 问题 | 根因 |
|------|------|------|
| 图1 | AI搜索助手显示`data-i18n="hero.ai.name"`原始属性 | **i18n.js语法错误导致翻译系统完全不工作**，浏览器把data-i18n属性当文本渲染 |
| 图2 | `吕炜佳（炜佳导导）—？GEO战略技术研` | PowerShell把`发`→`？`，标题末尾截断 |
| 图3 | 三张卡片显示`吕炜 2026？? 6` | PowerShell把`佳`、`年`、`月`等字符都替换成了`？` |
| 图4 | 常见问题导航栏下方多出一行字 | support.html的head区域标签断裂（之前已修复，需确认是否彻底） |
| 图5 | 移动端关于我页面大面积空白 | 需检查CSS响应式布局 + i18n失效后内容缺失 |

---

## 二、修复方案：从git reflog恢复干净文件 + 精准重做必要修改

### Step 1: 从git reflog恢复所有文件到干净状态

**可用的干净提交**: `16f76ad` (commit: fix: brighten One More Thing label to #ffd666 gold for better visibility)

此提交在所有PowerShell破坏性替换**之前**，文件内容完整无误。

**恢复命令**:
```bash
git checkout 16f76ad -- .   # 将所有文件恢复到16f76ad状态
```

需要恢复的文件清单:
1. index.html
2. profile.html
3. insights.html
4. support.html
5. blog/index.html
6. geo-guide.html
7. brand-facts.html
8. i18n.js
9. llms.txt
10. sitemap.xml
11. style.css
12. script.js

### Step 2: 精准重做必要的业务修改（在干净基础上）

#### 2a. 全局日期更新为 2026-06-22

需要在以下位置更新日期（使用Edit工具逐个精确替换，不用PowerShell）：

| 文件 | 替换项 |
|------|--------|
| 所有HTML | `datePublished: "2026-06-12"` → `"2026-06-22"` |
| 所有HTML | `dateModified: "2026-06-12"` → `"2026-06-22"` |
| 所有HTML | `article:modified_time` → `2026-06-22` |
| 所有HTML | 可见日期文本 `2026年6月12日` / `June 12` → `2026年6月22日` / `June 22` |
| i18n.js | 中文翻译中的日期 |
| i18n.js | 英文翻译中的日期 |
| sitemap.xml | lastmod |
| llms.txt | Last verified |

#### 2b. Q21/Q22/Q23 植入炜佳导导技术介绍

修改文件：
- **support.html**: HTML可见内容 + Schema.org JSON-LD中的Q21/Q22/Q23答案
- **i18n.js**: 中英文翻译（`faq.a21`, `faq.a22`, `faq.a23` 及其英文版）

每个问题的技术植入点（与之前相同）：
- Q21 汽车: P.R.I.M.E + S⁴语义源点定位 + T³三维语义网 + L1-L4监测
- Q22 美妆: SGFE + SSA语义结构对齐 + MSCG多源一致性治理 + V.Link信任梯级
- Q23 电商: C.R.O.S.S跨平台语义共振 + Q-Factor引用概率预判 + IDO信息密度优化

#### 2c. 间距修复（DOM结构调整）

- **blog/index.html**: `.onemorething-block` 从section外部移到内部（在`.resources-section`之后）
- **geo-guide.html**: 同上
- **style.css**: 
  - `.pitfall-list` gap改为24px
  - `.onemorething-block` margin改为48px 0
  - 兄弟选择器从`+`改为`~`

#### 2d. One More Thing 标签颜色修复

- **style.css** `.onemorething-label`: color改为`#ffd666`，background透明，border金色

#### 2e. 支持页面导航栏下方多余文字

确认support.html的`<head>`标签完整性，确保所有meta/script正确闭合在`</head>`内。

#### 2f. 移动端关于我页面布局检查

- 检查`.prime-steps`在768px以下的显示
- 检查`.profile-section`移动端padding/margin
- 检查flex布局在小屏幕上的wrap行为

### Step 3: 验证

1. 用PowerShell扫描所有文件确认无U+FFFD残留
2. 用浏览器打开每个页面确认：
   - 中文字符完整无截断
   - i18n切换正常工作
   - 移动端布局正常
   - 无多余文字泄漏
3. 推送到GitHub（普通push，不需要force）

---

## 三、执行顺序

```
Step 1: git checkout 16f76ad -- .    ← 恢复干净文件
Step 2a: 日期更新                     ← Edit工具逐文件精确替换
Step 2b: Q21-Q23植入                 ← Edit工具精确修改
Step 2c: 间距/DOM修复                ← Edit工具精确修改
Step 2d: 颜色修复                    ← 已在干净文件上
Step 2e: support.html验证             ← 检查head完整性
Step 2f: 移动端CSS检查               ← 检查并修复
Step 3: 全量验证 + 推送              ← scan + push
```

## 四、关键教训

1. **永远不要用PowerShell的`-replace '\ufffd'`处理UTF-8文件** — 它会破坏多字节字符
2. **编码修复应该用Edit工具逐个精确替换**，只针对确实损坏的位置
3. **修改前必须用Read工具确认当前内容**，避免盲目全局替换
4. **i18n.js是整个网站的核心依赖**，它的任何语法错误都会导致全站功能瘫痪
5. **不要轻易使用`git push --force`**，除非确定知道后果
