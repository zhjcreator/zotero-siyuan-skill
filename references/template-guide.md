# 笔记模板设计

## 设计原则

1. **与 siyuan-plugin-citation 兼容**：模板头部使用插件标准字段，确保文献池能正确识别
2. **信息分层清晰**：元数据 / 原文摘要 / AI 分析 / 用户笔记，各层分明
3. **超链可操作**：每条关键信息都有对应精度的 PDF 跳转链接
4. **标注优先**：用户已有的 PDF 标注（高亮/批注）自动归入对应区域

## 默认模板

```markdown
📄 [在 Zotero 中打开 PDF](zotero://open-pdf/library/items/{{pdfKey}})

---

**Title**:	{{title}}

**Author**:	{{authorString}}

**Year**:	{{year}}

**DOI**:	[{{doi}}](https://doi.org/{{doi}})

---

# 📌 Abstract

{{abstract}}

# 📂 Select on Zotero

[在 Zotero 中定位]({{zoteroSelectURI}})

# 📎 Files

{{files}}

# 📝 Zotero Notes

{{note}}

---

## 🔬 研究问题

[AI 基于全文分析总结的研究问题]

## ⚙️ 方法与实验

[AI 基于全文分析的方法总结]
{{#blueAnnotations}}
- `{{text}}` [→]({{zoteroOpenURI}})
{{/blueAnnotations}}

## 💡 核心发现

[AI 基于全文分析和黄色标注的核心发现]
{{#yellowAnnotations}}
- `{{text}}` [→]({{zoteroOpenURI}})
{{/yellowAnnotations}}

## 📖 关键引文

{{#redAnnotations}}
> {{text}}
> — [定位]({{zoteroOpenURI}})
{{/redAnnotations}}
{{#noteAnnotations}}
> **标注**: {{comment}}
> 原文: `{{text}}` — [定位]({{zoteroOpenURI}})
{{/noteAnnotations}}

## 🤔 思考与疑问

[AI 分析洞察]
{{#purpleAnnotations}}
- `{{text}}` [→]({{zoteroOpenURI}})
{{/purpleAnnotations}}

## 🔗 相关文献

[待补充]

## 📓 User Data {: custom-literature-block-type="user data"}

> 以下为你的个人笔记，不会被自动刷新覆盖。

```

## 区域说明

| 区域 | 来源 | 更新策略 |
|------|------|---------|
| 元数据头部 | Zotero API | 创建时写入，刷新时更新 |
| Abstract | Zotero 摘要字段 | 创建时写入 |
| Zotero Notes | Zotero 笔记 | 创建时写入 |
| 研究问题 | AI 分析全文 | 创建时生成，手动修改 |
| 方法与实验 | AI 分析全文 + 蓝色标注 | 创建时生成 |
| 核心发现 | AI 分析全文 + 黄色标注 | 创建时生成 |
| 关键引文 | 红色标注 + 批注 | 创建时导入，可手动补充 |
| 思考与疑问 | AI 洞察 + 紫色标注 | 创建时生成 |
| User Data | 用户手动编辑 | 永远不自动覆盖 |

## 标注颜色映射

| Zotero 颜色 | 归入区域 | 格式 |
|------------|---------|------|
| 🟡 黄色 | 核心发现 | `- text [→](zotero://...)` |
| 🔴 红色 | 关键引文 | `> text\\n> — [定位](zotero://...)` |
| 🔵 蓝色 | 方法与实验 | `- text [→](zotero://...)` |
| 🟢 绿色 | 核心发现（支撑） | `- text [→](zotero://...)` |
| 🟣 紫色 | 思考与疑问 | `- text [→](zotero://...)` |
| 📝 批注 | 关键引文 | `> **标注**: comment\\n> 原文: text — [定位](zotero://...)` |

## 超链格式

| 用途 | 格式 |
|------|------|
| 打开 PDF | `zotero://open-pdf/library/items/<pdfKey>` |
| 跳转页码 | `zotero://open-pdf/library/items/<pdfKey>?page=<0-based>` |
| 跳转标注 | `zotero://open-pdf/library/items/<pdfKey>?page=<n>&annotation=<key>` |
| 定位条目 | `zotero://select/library/items/<itemKey>` |
| 思源文档 | `siyuan://blocks/<docId>` |
| 块引用 | `((docId "text"))` |

## 自定义模板

在 `config.json` 中可指定自定义模板文件：

```json
{
  "litNote": {
    "templateFile": "/path/to/custom-template.md"
  }
}
```

模板变量参考 `zotero-item.js` 和 `zotero-notes.js` 的输出字段。
