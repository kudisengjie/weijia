# 五项问题修复计划 — 2026-06-22

## 问题诊断汇总

| 图号 | 页面 | 问题 | 根因 |
|------|------|------|------|
| 图1 | blog/index.html | 误区模块与OMT连在一起+文字颜色暗+层级包裹多 | `.pitfall-item`文字用灰色`var(--text-light)`；OMT虽已改`#ffffff`但需确认无覆盖；DOM嵌套层级深 |
| 图2 | blog/index.html | OMT位置错误（在资源下载之后） | OMT div在第422行（resources-section之后），应移到第366行（blog-disclaimer之后、resources-section之前） |
| 图3 | geo-guide.html | OMT文字颜色未变 + footer有"品牌事实" | ①CSS可能被覆盖 ②第417行footer-links中有硬编码`品牌事实`链接（所有6个HTML页面都有，不只support.html） |
| 图4 | geo-guide.html | 声明区域与GEO vs SEO表格贴在一起 | 缺少`.guide-intro-block ~ .compare-table-wrap`的间距规则 |
| 图5 | profile.html移动端 | 表格卡片式排版别扭 | 当前卡片式每行内容太长，需要更紧凑的设计 |

---

## 修复方案

### Fix 1: 图1 — 误区模块样式优化 + OMT文字确认白色

**文件**: [style.css](style.css)

1. **pitfall-item 文字颜色加深**：
   ```css
   .pitfall-item h4 { color: var(--text-dark); }  /* 已是深色 ✓ */
   .pitfall-item p { color: var(--text-dark); }   /* 从 text-light 改为 text-dark */
   ```

2. **pitfall-item 减少视觉层级**：去掉不必要的内边距和背景层次感
   ```css
   .pitfall-item { padding: 16px 20px; background: #fff; border: 1px solid var(--border-color); }
   ```

3. **确认 OMT p 颜色为纯白**：检查是否被其他规则覆盖
   ```css
   .profile-onemorething p { color: #ffffff !important; }  /* 添加 !important 确保生效 */
   ```

### Fix 2: 图2 — OMT移到资源下载前面

**文件**: [blog/index.html](blog/index.html)

当前结构（第362-431行）：
```
blog-disclaimer (第363行)
resources-section (第368行) ← 资源下载
onemorething-block (第422行) ← OMT在这里（错误）
```

目标结构：
```
blog-disclaimer (第363行)
onemorething-block ← OMT移到这里（正确）
resources-section (第368行) ← 资源下载
```

操作：剪切第422-430行的 `onemorething-block` 整块，粘贴到第366行（blog-disclaimer闭合后、resources-section前）

### Fix 3: 图3 — OMT颜色 + 全站footer删除"品牌事实"

**文件A**: [style.css](style.css)
```css
.profile-onemorething p { color: #ffffff !important; }
```

**文件B**: 所有含"品牌事实"footer链接的HTML文件（6个）
- [index.html](index.html) 第394行
- [profile.html](profile.html) 第340行
- [insights.html](insights.html) 第327行
- [blog/index.html](blog/index.html) 第445行
- [geo-guide.html](geo-guide.html) 第417行
- [brand-facts.html](brand-facts.html) 第258行

操作：逐个删除 `<a href="brand-facts.html">品牌事实</a>` 这一行

### Fix 4: 图4 — geo-guide模块间距

**文件**: [style.css](style.css)

当前兄弟选择器缺少 `.guide-intro-block ~ .compare-table-wrap` 规则。

在现有间距规则组中添加：
```css
.guide-intro-block ~ .compare-table-wrap,
.guide-intro-block ~ .synergy-cards {
    margin-top: 40px;
}
```

### Fix 5: 图5 — 移动端profile表格重新设计

**文件**: [style.css](style.css) 移动端媒体查询

重新设计思路：不再用卡片式堆叠（每行太长），改为**紧凑两栏信息展示**：
- 步骤字母(P/R/I/M/E)作为左侧大标签
- 右侧紧凑排列：模块名 + 问题 + 内容摘要（限制行数）
- 使用 `-webkit-line-clamp: 3` 限制内容高度
- 字体进一步缩小到 0.78rem
- 行距压缩到 1.5

---

## 执行顺序

```
Fix 1 → Fix 3(颜色部分) → Fix 2 → Fix 3(footer部分) → Fix 4 → Fix 5 → 验证 → 推送
```

## 安全约束

1. **只用 Edit 工具**精确修改，不用 PowerShell 替换
2. **每次修改后 Read 验证**
3. **推送前全量编码扫描**

---

# 品牌详情、轮播与 GEO 收录优化实施方案 — 2026-07-23

## 已确认范围

- 只修改 `E:\codex\weijia` 现有官网源文件，不创建新项目或工作树。
- “关于我”统一改为“品牌详情”，官网主体统一为“零雪AI”。
- 删除“炜佳导导”个人品牌、CEO、Person/ProfilePage 等公开表述；仅联系信息中的真实社交账号“炜佳导导GEO”保留。
- 首页和品牌详情页使用标题：`零雪AI|GEO服务商|GEO优化|GEO实战培训|AI推荐`。
- 左上角文字 Logo 改为小尺寸浅蓝渐变“零雪AI”。
- 品牌详情页导航下方采用 A 方案全宽轮播，使用用户提供的 5 张图片；第二张使用已改成“零雪AI”的 `17_50_02` 版本。
- 在既有 `articles/` 中发布 5 篇行业 GEO 文章，并在文章底部增加“近期文章”内部链接区。
- 优先完成静态 HTML 可抓取、robots、sitemap、llms.txt、语义结构、结构化数据和内容时效。

## 轮播设计与无障碍要求

| 序号 | 可见标题 | 图片源 |
|---|---|---|
| 1 | AI搜索语义网络与品牌可见度 | `15_55_44.png` |
| 2 | 零雪AI GEO优化与AI营销工作台 | `17_50_02.png` |
| 3 | AI搜索到品牌推荐的GEO商业闭环 | `16_21_00.png` |
| 4 | 传统搜索向生成式AI搜索的转型 | `16_27_00.png` |
| 5 | 企业品牌智能与AI推荐系统 | `16_22_19.png` |

- 首图在无 JavaScript 时保持可见；其余图片延迟加载。
- 提供上一张、下一张、圆点导航、键盘操作、焦点和悬停暂停。
- 自动播放间隔为 6 秒；系统启用减少动态效果时停用自动播放。
- 图片使用语义化文件名、准确 `alt`、固定宽高和 WebP 响应式资源，降低 LCP 与布局偏移。
- 标题与说明使用真实 HTML 文本，不把关键信息只放在图片中。

## 5 篇文章发布清单

1. `travel-industry-geo-service-provider.html`：旅游行业挑GEO优化服务商，五个维度先看清。
2. `automotive-industry-geo-service-provider.html`：车企做AI搜索优化，挑GEO服务商这5个维度先看清。
3. `lip-balm-geo-service-provider.html`：润唇膏行业GEO优化服务商怎么选？
4. `skincare-geo-service-provider.html`：护肤品品牌想被AI提到？选GEO服务商先问这四个问题。
5. `furniture-industry-geo-service-provider.html`：家具企业做GEO优化，服务商到底该怎么挑？

文章使用原 DOCX 的结论、选型维度、场景建议、表格和 FAQ；删除个人口吻、虚构保证、无法溯源的市场数字和绝对排名承诺。发布日期与修改日期设为 2026-07-23，作者与发布者均使用 Organization“零雪AI”。

## SEO/GEO 技术验收标准

- 所有核心内容直接存在于初始静态 HTML，不依赖 JavaScript 注入。
- 首页和品牌详情页部署 Organization；品牌详情页增加 Product/Service；文章页部署 Article 与可见 FAQ 对应的 FAQPage，author/publisher 均为 Organization。
- 全站删除 Person/ProfilePage 结构化数据，JSON-LD 与页面可见文字一致。
- `robots.txt` 放行通用搜索与 AI 爬虫，声明主 sitemap 与 `llms.txt`。
- `sitemap.xml`、`sitemap-articles.xml` 和 `llms.txt` 收录 5 个新 URL，并使用有意义的 `lastmod`。
- 新文章具备唯一 title、description、canonical、H1、H2、摘要、表格或清单、FAQ 和近期文章内链。
- 图片首屏资源优先加载，非首屏资源延迟加载；不引入阻塞型第三方框架。

## 测试驱动执行顺序

1. 扩展现有 `tools/validate-requested-fixes.mjs`：断言品牌详情命名、精确标题、Logo、五图轮播与加载策略。
2. 扩展 `tools/validate-site-content-consistency.mjs`：扫描旧品牌、CEO、Person/ProfilePage、错误作者和缺失语义标题。
3. 扩展 `tools/validate-blog-word-articles.mjs` 与 `tools/validate-recent-articles.mjs`：断言 5 篇新文章、Article/FAQPage、近期文章区和内部链接。
4. 运行上述验证并记录预期失败，确认测试确实覆盖尚未实现的需求。
5. 修改核心 HTML、CSS、JavaScript、i18n、robots、sitemap、llms 和文章源文件。
6. 生成语义化 WebP 图片资源并核对体积、尺寸、加载属性。
7. 运行全部现有验证脚本、JSON-LD 解析、站内链接检查、旧品牌扫描和 `git diff --check`。
8. 使用本机 Chrome 命令行进行桌面与移动端截图 QA，不使用 Codex 内置浏览器。
