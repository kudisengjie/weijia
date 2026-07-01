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
