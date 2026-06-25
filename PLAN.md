# zotero-siyuan-skill 规划方案

> 版本: v0.4 | 最后更新: 2026-06-24 | 变更：新增 Zotero 反向标注（note 类标注 + siyuan:// 超链）

## 1. 概述与目标

### 场景
用户在 Zotero 中阅读**PDF 格式论文**，借助 MinerU/arxiv2md 将 PDF 转为 Markdown 供 AI 理解全文，自动在思源中生成文献笔记，笔记通过 `zotero://` 协议直接超链到 PDF 原文（支持页码定位），并与 `siyuan-plugin-citation` 的引用体系无缝集成。

### 核心能力

| 编号 | 能力 | 描述 |
|------|------|------|
| R1 | PDF→MD 转换 | 调用 MinerU flash-extract 将 Zotero 中的 PDF 转为 Markdown，供 AI 阅读全文 |
| R2 | 初始笔记生成 | 基于全文 Markdown + Zotero 元数据，AI 生成结构化初稿笔记 |
| R3 | 智能补充 | 用户提问时，AI 判断是否应将回答内容补充到对应笔记 |
| R4 | PDF 超链 | 笔记中的引用/要点通过 `zotero://open-pdf` 协议超链到 PDF 原文，支持页码与标注级定位 |
| R5 | 反向标注 | AI 在 Zotero PDF 上创建 note 类标注，标注内容通过 `siyuan://blocks/<docId>` 反向超链到思源笔记 |
| R5 | 标注级定位 | 优先使用 Zotero PDF 标注 key 生成 `annotation=` 链接，实现比页码更精准的跳转 |

### 非目标

| 非目标 | 说明 |
|--------|------|
| 替代 siyuan-plugin-citation | 本 skill 只创建/补充笔记并写入兼容属性，不接管引用样式渲染 |
| 修改 Zotero 文献元数据 | 不修改标题、作者、标签等原始数据（除非用户明确要求） |
| 自研 PDF 解析器 | PDF→MD 交给 MinerU/arxiv2md，skill 只编排和缓存结果 |
| 保证所有 AI 推断都有精确页码 | 无 Zotero 标注时只做页码级或文件级降级，不伪造精准定位 |
| 创建 highlight 类标注 | highlight 需要精确的 PDF 文本坐标，本文本 skill 只创建 note（便利贴）类标注 |

---

## 2. 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                        opencode (AI)                          │
│                                                               │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐ │
│  │ 意图理解 │  │ 生成笔记内容 │  │ 判断补充 │  │ 反向标注 │ │
│  │          │  │              │  │          │  │ 决策     │ │
│  └──────────┘  └──────────────┘  └──────────┘  └──────────┘ │
└────┬──────────────┬──────────────┬──────────────┬────────────┘
     │              │              │              │
     ▼              ▼              ▼              ▼
┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────────┐
│  MinerU   │ │ zotero-   │ │ siyuan-   │ │ siyuan-plugin     │
│  (PDF→MD) │ │ siyuan-   │ │ skill     │ │ -citation         │
│           │ │ skill(新) │ │           │ │                   │
│ flash-    │ │           │ │ 文档 CRUD │ │ 引用渲染          │
│ extract   │ │ • Local   │ │ 块操作    │ │ 文献池            │
│           │ │   API RO  │ │ 搜索      │ │ custom-           │
│           │ │ • Local   │ │           │ │ literature-key    │
│           │ │   API RW  │ │           │ │                   │
│           │ │ • 笔记    │ │           │ │                   │
│           │ │   构建    │ │           │ │                   │
│           │ │ • PDF 超  │ │           │ │                   │
│           │ │   链注入+ │ │           │ │                   │
│           │ │   反向    │ │           │ │                   │
└─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └──────────┬────────┘
      │             │             │                  │
      ▼             ▼             ▼                  ▼
┌──────────────────────────────────────────────────────────────┐
│  Zotero 桌面端 ← 写标注 →   SiYuan Note      MinerU Cloud    │
│  localhost:23119           localhost:6806    api.mineru.net   │
│  zotero://open-pdf ←──→  siyuan://blocks/                    │
└──────────────────────────────────────────────────────────────┘
```

### 分层职责

| 层 | 负责组件 | 职责 |
|----|---------|------|
| AI 决策层 | opencode + SKILL.md | 意图理解、全文分析、笔记生成、补充判断、反向标注决策 |
| PDF 转换层 | MinerU flash-extract | PDF → Markdown，供 AI 理解论文全文 |
| 脚本执行层 | zotero-siyuan-skill/scripts/* | Zotero 数据读写、PDF 附件提取、笔记模板渲染、SiYuan 文献笔记创建、双向超链注入 |
| SiYuan 操作层 | siyuan-skill/scripts/* | 通用文档/块 CRUD（作为子进程调用） |
| 引用渲染层 | siyuan-plugin-citation | 引用 span 渲染、文献池维护、文献笔记刷新 |

---

## 3. 关键设计决策

### 3.1 Zotero 版本与 API

Zotero 7、8、9 是**桌面客户端**版本号，Web API 始终是 **v3**（`Zotero-API-Version: 3`），端点、认证方式均未变。当前 Zotero 9 确认兼容。

### 3.2 Zotero 数据访问：Local API（首选）

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| Local API (`localhost:23119`) | 无需 API Key，本地即用，实时数据 | 需 Zotero 运行 | ✅ 首选 |
| Web API (api.zotero.org) | 远程可用 | 需 API Key，有速率限制 | 备选（远程同步场景） |

**Local API 特性**：
- 无需认证，`http://localhost:23119/api/` 即用
- 无速率限制，无分页上限
- 仅限本地访问，需 Zotero → Settings → Advanced → Allow local API
- 不支持 `format=atom`，其余与 Web API v3 一致

**远程 Web API 仅作为备选**：如果用户不在 Zotero 本机工作，才使用 `https://api.zotero.org` + `ZOTERO_API_KEY`。

### 3.3 依赖 siyuan-skill 的模式

zotero-siyuan-skill 的脚本**不复制** siyuan-skill 的代码，而是通过 `child_process.spawn()` 调用其 CLI：

```
zotero-siyuan-skill/scripts/lit-note-create.js
    │
    ├── spawn('node', [siyuanSkillDir + '/scripts/create.js', ...])
    ├── spawn('node', [siyuanSkillDir + '/scripts/block-attrs.js', ...])
    └── spawn('node', [siyuanSkillDir + '/scripts/block-insert.js', ...])
```

- siyuan-skill 路径通过环境变量 `SIYUAN_SKILL_DIR` 或 config.json 配置
- 环境变量共享（`SIYUAN_BASE_URL`, `SIYUAN_TOKEN`）
- 所有 JSON stdout 解析复用 siyuan-skill 的 `{success, data, message}` 格式

### 3.4 PDF→Markdown 管道

```
Zotero PDF 附件
      │
      ▼
zotero-attachment.js  ← 获取 PDF 本地路径
      │
      ▼
mineru-open-api flash-extract <pdf>  ← 无 token，快速转换
      │
      ▼
Markdown 全文  ← 供 AI 分析，生成笔记
```

**为什么用 MinerU flash-extract**：
- 无需 token，零配置，开箱即用
- 命令：`mineru-open-api flash-extract paper.pdf` → stdout 输出 Markdown
- 支持公式、表格、OCR
- 10MB/20页限制对大多数学术论文足够
- 超限时降级到 `mineru-open-api extract`（需 token）

### 3.5 PDF 超链方案：zotero:// 协议（四层精准定位）

```
zotero://open-pdf/library/items/<pdfKey>                                          打开 PDF
zotero://open-pdf/library/items/<pdfKey>?page=<n>                                  打开 PDF 第 n 页
zotero://open-pdf/library/items/<parentKey>?page=<n>&annotation=<annotationKey>    打开 PDF 并跳转到指定标注
```

> 标注超链格式由 siyuan-plugin-citation 确认，见 `src/database/zoteroLibrary.ts:245`。

**四层超链体系**：

| 层级 | 精度 | 协议 | 用途 | 示例 |
|------|------|------|------|------|
| L1 文献笔记 | 文档级 | `siyuan://plugins/...` | 打开思源中的文献笔记 | `siyuan://plugins/siyuan-plugin-citation/open-ref?key=BNQ6EZIN` |
| L2 PDF 文件 | 文件级 | `zotero://open-pdf/...` | 在 Zotero 中打开 PDF | `zotero://open-pdf/library/items/BNQ6EZIN` |
| L3 PDF 页码 | 页级 | `zotero://open-pdf/...?page=` | 跳转到指定页 | `zotero://open-pdf/library/items/BNQ6EZIN?page=5` |
| L4 PDF 标注 | 标注级 | `zotero://open-pdf/...?page=&annotation=` | 跳转到具体高亮/批注位置 | `zotero://open-pdf/library/items/PARENT?page=5&annotation=HIGHLIGHT01` |

**参数说明**：
- `<itemKey>`：Zotero 文献条目的 key，用于 `custom-literature-key` 与文献笔记关联
- `<pdfKey>` / `<parentKey>`：PDF 附件条目的 key，用于 `zotero://open-pdf/library/items/<pdfKey>`
- `<annotationKey>`：Zotero 标注的唯一 key（每个高亮/下划线/批注都有独立 key）

**重要区分**：`custom-literature-key` 使用文献条目 `itemKey`，PDF 打开/标注跳转使用 PDF 附件 `pdfKey`。二者通常不同，不能混用。

**笔记中的典型用法**：
```markdown
📄 [在 Zotero 中打开 PDF](zotero://open-pdf/library/items/BNQ6EZIN)

## 核心发现
- 自注意力机制消除了循环结构 ([第3页](zotero://open-pdf/library/items/BNQ6EZIN?page=3))
- "The Transformer allows significantly more parallelization" → [跳转到标注](zotero://open-pdf/library/items/PARENTKEY?page=5&annotation=HIGHLIGHT01)
```

**标注数据获取**：
```
Zotero 文献条目 itemKey
      │
      ▼
GET /api/users/0/items/<itemKey>/children  ← 找到 PDF 附件 pdfKey
      │
      ▼
GET /api/users/0/items/<pdfKey>/children?itemType=annotation
      │
      ▼
返回标注列表 [{ key, annotationType, annotationText, annotationComment,
               annotationColor, annotationPageLabel, annotationPosition, ... }]
      │
      ▼
zotero-notes.js 解析标注 → 生成 L4 超链
```

**标注颜色与语义映射**（AI 生成笔记时的参考）：

| Zotero 颜色 | 常见用途 | 笔记中处理 |
|------------|---------|-----------|
| 黄色 Yellow | 重要论点 | 归入"核心发现"，生成 L4 超链 |
| 红色 Red | 关键/问题 | 归入"关键引文"或"待解决问题"，生成 L4 超链 |
| 蓝色 Blue | 方法/术语 | 归入"方法与实验"，生成 L4 超链 |
| 绿色 Green | 支持证据 | 归入"支撑材料"，生成 L4 超链 |
| 紫色 Purple | 疑问/批判 | 归入"个人思考"，生成 L4 超链 |
| 批注 Note | 用户评论 | 直接纳入"关键引文"并保留评论内容 |

**页码规范**：优先使用 `annotationPosition.pageIndex` 生成链接，保持与 `siyuan-plugin-citation` 一致；展示文本可使用 `annotationPageLabel`。如果实测 Zotero 需要 1-based 页码，再在实现中增加可配置偏移 `ZOTERO_PDF_PAGE_OFFSET`。

### 3.5.1 Markdown 缓存与可追溯性

PDF 转换结果需要缓存，避免每次提问都重复跑 MinerU：

```
cache/<itemKey>/
├── paper.md              # MinerU/arxiv2md 转换结果
├── annotations.json      # Zotero 标注快照
├── metadata.json         # Zotero 元数据快照
└── manifest.json         # pdfKey、mtime、转换工具、hash、时间戳
```

缓存失效条件：
1. PDF 附件 `dateModified` 或文件 hash 变化
2. Zotero 标注数量、标注 key、标注 `dateModified` 变化
3. 用户显式传入 `--refresh`

笔记文档属性中额外写入：
- `custom-zotero-item-key = <itemKey>`
- `custom-zotero-pdf-key = <pdfKey>`
- `custom-zotero-siyuan-cache-hash = <hash>`

### 3.5.2 反向标注：在 PDF 上创建 note 超链回 SiYuan

```
用户场景：AI 分析完论文全文后，不仅生成 SiYuan 笔记，
         还在 Zotero PDF 上创建 note（便利贴）标注，
         标注内容中包含 siyuan://blocks/<docId> 链接，
         用户阅读 PDF 时可一键跳回 SiYuan 的对应笔记。
```

**双向链接闭环**：

```
┌─────────────────────┐          ┌──────────────────────┐
│   Zotero PDF 标注    │  note    │   SiYuan 文献笔记     │
│                     │←────────│                      │
│   📝 自注意力机制    │ annotationComment 携带         │
│   的核心创新点在此页 →│ siyuan://blocks/<docId>│      │
│   [打开SiYuan笔记]   │          │                      │
│                     │          │ 📄 [打开Zotero PDF]   │
│                     │────────→│  (zotero://open-pdf)  │
│                     │  点击    │                      │
└─────────────────────┘          └──────────────────────┘
```

**写标注的 Zotero Local API**：

```
POST http://localhost:23119/api/users/0/items
Content-Type: application/json
Zotero-API-Version: 3
```

**请求体**（创建 note 类标注）：
```json
{
  "itemType": "annotation",
  "parentItem": "<pdfKey>",
  "annotationType": "note",
  "annotationText": "",
  "annotationComment": "<h2>📝 核心发现：自注意力机制</h2><p>Transformer 用自注意力替代了循环结构，极大提升了并行化能力。</p><p><a href=\"siyuan://blocks/20240601120000-abc1234\">打开思源笔记</a></p>",
  "annotationPosition": "{\"pageIndex\":4,\"rects\":[[300,10,316,26]]}",
  "annotationColor": "#ffd400",
  "annotationPageLabel": "5",
  "tags": []
}
```

**note 标注的关键字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `itemType` | `"annotation"` | 固定值 |
| `parentItem` | string | PDF 附件的 key (`pdfKey`) |
| `annotationType` | `"note"` | 便利贴类标注，不需要文本坐标 |
| `annotationComment` | HTML string | 标注的富文本内容，可嵌入 `<a href="siyuan://...">` |
| `annotationPosition` | JSON string | 标注在页面上的位置 |
| `pageIndex` | number (0-based) | 标注所在页索引 |
| `rects` | `[[x1,y1,x2,y2]]` | 标注图标在页面的像素坐标 |
| `annotationPageLabel` | string | 标注所在页标签（显示用，如 "5"） |
| `annotationColor` | hex string | 标注颜色 |

**标注决策规则**（SKILL.md 指导 AI）：

| AI 发现 | 操作 | 标注内容 |
|---------|------|---------|
| 论文核心创新点 | 在对应页创建 note | 简要标题 + 1-2 句总结 + siyuan:// 链接 |
| 用户提问后补充的内容 | 创建 note 或追加到已有 note | 问答摘要 + siyuan:// 链接 |
| 论文关键公式/图表 | 在对应页创建 note | 标题 + siyuan:// 链接 |
| 已有标注不再重复 | 跳过 | - |

**实现方式对比**：

| 方式 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| Zotero Local API `POST /items` | 无需插件，直接 HTTP | 标注参数格式严格 | ✅ 采用 |
| debug-bridge `Zotero.Items` | 最灵活 | 需安装 debug-bridge 插件 | 备选 |
| `annotationType: "highlight"` | 精准选中文字 | 需 PDF 文本坐标解析，实现复杂 | ❌ 不做 |

### 3.6 与 siyuan-plugin-citation 的兼容协议

`siyuan-plugin-citation` 通过以下机制识别文献笔记：

```
┌──────────────────────────────────────┐
│         文献笔记文档 (type='d')        │
│                                      │
│  custom-literature-key = "1_ABC123"  │  ← 块属性：主键
│  custom-entry-data    = "{...JSON}"  │  ← 块属性：完整元数据
│  custom-paper-note    = "true"       │  ← 新增：标记为 zotero-siyuan-skill 笔记
│                                      │
│  文档内容（自动生成 + 用户数据区）     │
│  ┌──────────────────────────────┐   │
│  │ # 标题                       │   │
│  │ **作者**: ...                 │   │
│  │ **期刊**: ...                 │   │
│  │                              │   │
│  │ ## Abstract                  │   │
│  │ ...                          │   │
│  │                              │   │
│  │ ## 核心发现                   │   │
│  │ ...                          │   │
│  │                              │   │
│  │ ## User Data {: custom-      │   │  ← siyuan-plugin-citation 用户数据区
│  │      literature-block-type=  │   │
│  │      "user data"}            │   │
│  │ ...用户自己的笔记...          │   │
│  └──────────────────────────────┘   │
└──────────────────────────────────────┘
```

**兼容要点**：
1. 设置 `custom-literature-key` = `"{libraryID}_{itemKey}"`（如 `1_BNQ6EZIN`）
2. 设置 `custom-entry-data` = JSON 序列化的文献条目
3. 保留 `# User Data` 区域（带 `custom-literature-block-type="user data"` 属性）
4. 如果用户已通过 siyuan-plugin-citation 创建了文献笔记，则复用现有文档而非重复创建
5. 不覆盖 `custom-entry-data` 中插件已有字段，只追加本 skill 的 `custom-zotero-*` 属性

### 3.7 AI 补充决策逻辑

```
用户提问
    │
    ▼
┌─────────────────┐     否     ┌─────────┐
│ 是否关于当前论文？│ ────────→ │ 仅回答   │
└────────┬────────┘           └─────────┘
         │ 是
         ▼
┌─────────────────┐     否     ┌─────────┐
│ 回答是否为新知？ │ ────────→ │ 仅回答   │
│ (非重复已有笔记) │           └─────────┘
└────────┬────────┘
         │ 是
         ▼
┌─────────────────────┐
│ 补充到笔记中         │
│ 1. 定位目标文档/块   │
│ 2. 插入或更新块      │
│ 3. 告知用户补充位置  │
└─────────────────────┘
```

**判断标准**（写在 SKILL.md 中指导 AI）：
- ✅ 应补充：用户明确要求"记下来"、"补充到笔记"；回答包含论文中没有的新理解/分析/总结
- ❌ 不补充：纯事实查询（如"这篇文章发表在哪年"）；操作性问题（如"怎么打开 PDF"）
- ⚠️ 询问用户：不确定时，简要询问"要将这个补充到笔记中吗？"

---

## 4. 文件结构

```
zotero-siyuan-skill/
├── SKILL.md                          # 主入口，AI 指令
├── _meta.json                        # 元数据
├── package.json                      # NPM 元数据（零依赖）
├── .gitignore                        # 忽略 config.json
│
├── assets/
│   └── config-template.json          # 配置模板
│
├── scripts/                          # CLI 脚本
│   ├── lib/
│   │   ├── zotero-client.js          # Zotero Local API 客户端
│   │   ├── note-builder.js           # 笔记内容构建器（模板渲染 + PDF 超链注入）
│   │   └── siyuan-bridge.js          # 调用 siyuan-skill 脚本的桥接器
│   │
│   ├── zotero-status.js              # 检查 Zotero 连接状态
│   ├── zotero-item.js                # 获取 Zotero 条目元数据（含 PDF 路径）
│   ├── zotero-items.js               # 搜索/列出 Zotero 条目
│   ├── zotero-notes.js               # 获取 Zotero 条目的笔记/标注（含页码）
│   ├── zotero-attachment.js          # 获取 PDF 附件的本地路径
│   │
│   ├── pdf-to-md.js                  # 调用 MinerU 将 PDF 转 Markdown
│   │
│   ├── zotero-write-annotation.js    # 在 Zotero PDF 上创建 note 标注（含 siyuan:// 超链）
│   │
│   ├── lit-note-create.js            # 创建文献笔记文档（含 PDF 超链）
│   ├── lit-note-append.js            # 向文献笔记追加内容
│   ├── lit-note-find.js              # 查找文献笔记（按 itemKey/citekey/标题）
│   │
│   └── ask-supplement.js             # 分析是否应补充笔记（供 AI 调用）
│
├── references/
│   ├── workflow.md                   # 完整工作流说明
│   ├── zotero-api.md                 # Zotero Local/Web API 参考
│   └── template-guide.md             # 笔记模板定制指南
│
└── examples/
    ├── generate-note.md              # 初始笔记生成示例
    └── supplement-note.md            # Q&A 补充笔记示例
```

---

## 5. 核心脚本规范

### 5.1 pdf-to-md.js — PDF 转 Markdown

```
用途：调用 MinerU flash-extract 将 PDF 附件转为 Markdown，供 AI 分析全文
输入：
  --pdf <path>                PDF 文件路径
  --key <itemKey>             或通过 Zotero itemKey 自动获取 PDF
  --output <path>             输出目录（可选，默认 /tmp/zotero-siyuan/<hash>/）
输出：Markdown 内容（stdout）或输出文件路径
```

**转换流程**：
1. 若提供 `--key`：通过 Zotero API 获取 PDF 附件路径（调用 zotero-attachment.js 逻辑）
2. 若提供 `--pdf`：直接使用该路径
3. 检查文件大小（>10MB 警告）和页数（>20页警告）
4. 执行 `mineru-open-api flash-extract <pdf> --language en`
5. 返回 stdout Markdown 内容

**输出 JSON 结构**：
```json
{
  "success": true,
  "data": {
    "markdown": "# Title\n\n...",
    "pdfPath": "/path/to/paper.pdf",
    "pageCount": 12,
    "convertMethod": "mineru-flash"
  }
}
```

**容错**：
- MinerU 未安装 → 提示安装 `npm install -g mineru-open-api`
- 文件超限 → 建议用 `mineru-open-api extract`（需 token）
- 转换失败 → 降级为仅使用 Zotero 摘要/元数据生成笔记

### 5.1.1 zotero-write-annotation.js — 在 PDF 上创建 note 标注

```
用途：在 Zotero PDF 上创建 note（便利贴）类标注，标注内容嵌入
      siyuan://blocks/<docId> 反向超链，用户在 Zotero 中点击
      标注即可跳转到思源笔记
输入：
  --pdf-key <pdfKey>              PDF 附件的 key
  --page <pageIndex>              页码（0-based，来自 annotationPosition.pageIndex）
  --page-label <label>            页码标签（显示用，如 "5"）
  --comment <html>                标注 HTML 内容（含 siyuan:// 链接）
  --color <hex>                   标注颜色（默认 #ffd400 黄色）
  --position-x <x>                标注图标 X 坐标（默认 300）
  --position-y <y>                标注图标 Y 坐标（默认 10）
  --dry-run                       仅打印请求体，不实际创建
输出：创建的标注 key 和 zoteroOpenURI
```

**请求格式**：
```
POST http://localhost:23119/api/users/0/items
Zotero-API-Version: 3
Content-Type: application/json

Body: {
  itemType: "annotation",
  parentItem: "<pdfKey>",
  annotationType: "note",
  annotationText: "",
  annotationComment: "<p>...<a href='siyuan://blocks/<id>'>...</a></p>",
  annotationPosition: "{\"pageIndex\":4,\"rects\":[[300,10,316,26]]}",
  annotationColor: "#ffd400",
  annotationPageLabel: "5",
  tags: []
}
```

**关键细节**：
- `annotationPosition` 必须是 JSON 字符串（不是对象），用 `JSON.stringify()` 序列化
- `annotationComment` 支持 HTML 标签和 `siyuan://` 协议链接
- `rects` 格式为 `[[x1, y1, x2, y2]]`，定义标注图标在页面的位置和大小
- `pageIndex` 是 0-based（与 Zotero 内部存储一致）
- `annotationPageLabel` 是显示用的字符串（如 "5", "xii", "A-3"）
- 同一位置重复创建会产生多个重叠的 note，需先 check 是否存在

**容错**：
- 无 PDF 附件 → 跳过反向标注
- Local API 写权限不足 → 提示用户检查 Zotero Advanced 设置
- 标注创建失败 → 记录错误，不影响笔记创建

```
用途：从 Zotero 获取指定条目的完整元数据
输入：--key <itemKey> | --citekey <citekey> | --selected（当前选中）
输出：JSON 格式的文献元数据 + PDF 路径 + 笔记列表
```

**调用 Zotero Local API**：
```
GET /api/users/0/items/<itemKey>
Headers: Zotero-API-Version: 3
```

**输出 JSON 结构**：
```json
{
  "success": true,
  "data": {
    "key": "BNQ6EZIN",
    "libraryID": 1,
    "title": "Attention Is All You Need",
    "shortTitle": "",
    "authors": ["Vaswani, Ashish", "Shazeer, Noam", ...],
    "firstAuthor": "Vaswani",
    "shortAuthor": "Vaswani et al.",
    "year": 2017,
    "journal": "NeurIPS",
    "volume": "30",
    "pages": "",
    "doi": "10.xxxx/xxxxx",
    "url": "https://...",
    "abstract": "...",
    "type": "journalArticle",
    "tags": ["transformer", "attention"],
    "collections": ["Papers/ML"],
    "pdfPath": "/path/to/file.pdf",
    "pdfKey": "PARENTKEY",
    "pdfOpenURI": "zotero://open-pdf/library/items/PARENTKEY",
    "notes": [
      { "text": "...", "tags": ["important"] }
    ],
    "dateAdded": "2023-01-01",
    "dateModified": "2024-06-01"
  }
}
```

### 5.3 zotero-notes.js — 获取笔记/标注（含 PDF 标注）

```
用途：获取 Zotero 条目的笔记和 PDF 标注
输入：--key <itemKey>
输出：结构化的笔记和标注数据（含标注 key、页码、颜色、zoteroOpenURI）
```

**调用 Zotero Local API**：
```
# 获取条目的子项目（含笔记和 PDF 附件）
GET /api/users/0/items/<itemKey>/children

# 获取 PDF 附件的标注
GET /api/users/0/items/<pdfKey>/children?itemType=annotation
```

**标注输出结构**（关键字段）：
```json
{
  "key": "HIGHLIGHT01",
  "annotationType": "highlight",
  "annotationText": "The Transformer allows significantly more parallelization...",
  "annotationComment": "核心创新点",
  "annotationColor": "#ffd400",
  "annotationColorName": "yellow",
  "annotationPageLabel": "5",
  "annotationPosition": { "pageIndex": 5 },
  "parentKey": "PARENTKEY",
  "zoteroOpenURI": "zotero://open-pdf/library/items/PARENTKEY?page=5&annotation=HIGHLIGHT01"
}
```

**输出 JSON 结构**：
```json
{
  "success": true,
  "data": {
    "notes": [{ "key": "NOTE01", "text": "...", "tags": [] }],
    "annotations": {
      "byColor": {
        "yellow": [{ "text": "...", "zoteroOpenURI": "...", "page": 5, ... }],
        "red": [...],
        "blue": [...],
        "green": [...],
        "purple": [...]
      },
      "all": [...]
    },
    "pdfKey": "PARENTKEY"
  }
}
```

### 5.4 lit-note-create.js — 创建文献笔记

```
用途：在思源中创建文献笔记文档，设置 citation 兼容属性
输入：
  --key <itemKey>
  --library-id <id>          (default: 1)
  --notebook <notebookId>    (default: 使用 SIYUAN_DEFAULT_NOTEBOOK)
  --path <path>              (default: "/References")
  --title <title>            文献笔记标题
  --content <markdown>       笔记内容（markdown）
  --entry-data <json>        完整的 Zotero 条目数据
输出：创建的文档 ID、路径
```

**创建流程**：
1. 先调用 `lit-note-find.js` 检查是否已存在（通过 `custom-literature-key`）
2. 若存在 → 返回已有文档 ID（可选 `--force` 覆盖）
3. 若不存在 → 调用 siyuan-skill 的 `create.js` 创建文档
4. 设置块属性：
   - `custom-literature-key = "{libraryID}_{itemKey}"`
   - `custom-entry-data = <json>`
   - `custom-paper-note = "true"`（标记为本 skill 创建的笔记）
   - `custom-zotero-item-key = <itemKey>`
   - `custom-zotero-pdf-key = <pdfKey>`
5. 在内容末尾自动添加 User Data 区域标记
6. 返回文档 ID 和路径

**关键实现细节**：
- 调用 siyuan-skill 的 `create.js` 时，内容需转义 `\n` → `\\n`（符合 format-standard.md）
- 创建后用 `block-attrs.js` 设置自定义属性
- 标题中不可包含 `/` 等非法路径字符

### 5.5 lit-note-append.js — 追加内容

```
用途：向文献笔记追加或更新内容块
输入：
  --doc-id <id>              目标文档 ID
  --content <markdown>        要追加的内容
  --section <sectionName>     目标区域（如 "User Data", "核心发现"）
  --mode append|replace       追加或替换
输出：更新的块 ID 列表
```

**追加策略**：
1. 获取文档内容 → 解析标题结构
2. 定位 `--section` 对应的标题块
3. `append` 模式：在目标区域末尾插入新块
4. `replace` 模式：替换目标区域的全部内容
5. 使用 siyuan-skill 的 `block-insert.js` 或 `block-update.js`

### 5.6 lit-note-find.js — 查找文献笔记

```
用途：按 itemKey 或标题查找已存在的文献笔记
输入：--key <itemKey> | --title <title>
输出：文档 ID、路径，未找到则 success=false
```

**查找方式**：
1. 通过 SQL 查询 `custom-literature-key` 属性（首选）
2. 通过 siyuan-skill 的 `search.js` 搜索标题（备选）

### 5.7 zotero-status.js — 检查连接

```
用途：检查 Zotero 是否运行且 API 可用
输入：无
输出：{ running: true/false, apiVersion: "..." }
```

---

## 6. 工作流

### 6.1 初始笔记生成工作流（含 PDF 全文分析）

```
用户："为这篇论文生成笔记"
     │
     ▼
[1] 确定目标论文
    ├── 用户指定 itemKey / citekey
    ├── 获取 Zotero 当前选中条目
    └── 列出最近添加的条目让用户选择
     │
     ▼
[2] 获取论文数据
    ├── zotero-item.js --key <key>             → 元数据 + PDF 路径
    └── zotero-notes.js --key <key>            → 笔记 + PDF 标注（含 key/页码/颜色）
     │
     ▼
[3] PDF 转 Markdown（全文分析）
    └── pdf-to-md.js --key <key>               → Markdown 全文
     │
     ▼
[4] AI 分析全文 + 标注 + 生成笔记
    ├── 输入：元数据 + Markdown 全文 + PDF 标注列表
    ├── 结构化输出（见模板）
    ├── 标注按颜色分类归入对应区域（黄色→核心发现，红色→关键引文，蓝→方法…）
    ├── 每个要点附带最佳精度超链：
    │   ├── 有对应标注 → L4 标注级（zotero://open-pdf/...?annotation=）
    │   ├── 知道页码 → L3 页码级（zotero://open-pdf/...?page=）
    │   └── 无法定位 → L2 文件级（zotero://open-pdf/...）
    └── 顶部注入 PDF 入口链接
     │
     ▼
[5] 检查是否已存在
    └── lit-note-find.js --key <key>
     │
     ▼
[6] 创建/更新文献笔记
    ├── lit-note-create.js --key <key> --content <md> --entry-data <json>
    └── 返回文档 ID（docId）给用户
     │
     ▼
[7] 反向标注（可选）
    ├── 对每个 AI 识别出的关键发现/用户提问补充的内容
    ├── zotero-write-annotation.js --pdf-key <pdfKey> --page <n>
    │       --comment "核心发现 + <a href='siyuan://blocks/<docId>'>打开笔记</a>"
    └── 标注创建后返回 annotationKey 和 zoteroOpenURI
     │
     ▼
[8] 确认
    └── 告知笔记位置、文档 ID、PDF 超链可用、反向标注数量
```

### 6.2 Q&A 智能补充工作流

```
用户提问
     │
     ▼
[1] AI 判断
    ├── 问题是否关于当前/最近讨论的论文？
    ├── 回答是否提供新信息？
    └── 输出决策 + 理由
     │
     ▼
[2] 如果是，定位目标笔记
    └── lit-note-find.js --key <key>
     │
     ▼
[3] 获取笔记当前内容
    └── siyuan-skill content.js <docId>
     │
     ▼
[4] AI 生成补充内容
    ├── 确定目标区域（User Data / 核心发现 / 方法 / ...）
    └── 生成适合插入的 markdown
     │
     ▼
[5] 补充到笔记
    └── lit-note-append.js --doc-id <id> --section "User Data" --content <md>
     │
     ▼
[6] 返回
    └── 告知用户已补充到笔记的哪个位置
```

### 6.3 引用超链工作流

```
                        Zotero 条目
                       key: ABC123
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
      ┌──────────────┐ ┌──────────┐ ┌──────────────┐
      │ 文献笔记文档  │ │ 用户文档A │ │ 用户文档B    │
      │ docId: D001  │ │          │ │              │
      │              │ │ ((D001   │ │ ((D001       │
      │ key=1_ABC123 │ │  "Vaswani│ │  "Attention" │
      │              │ │  et al.  │ │  ))          │
      │ auto: 自动   │ │  2017")) │ │              │
      │ user: 用户   │ │          │ │              │
      └──────────────┘ └──────────┘ └──────────────┘
```

**siyuan-plugin-citation 如何使用这个链接**：
- 插件通过 `custom-literature-key` 属性查找文献笔记文档
- 插件渲染 `((docId "anchor"))` 为可点击的引用 span
- 用户点击引用 span → 跳转到文献笔记文档
- 用户右键引用 → 可更改引用样式、刷新文献信息

**本 skill 如何建立链接**：
- 在文献笔记内容中插入自引用块（供 siyuan-plugin-citation 用于定位 User Data 区域）
- 不在笔记中重复插入引用 span（这是插件的工作）
- 如果用户要求在其他文档中引用该文献，用标准格式 `((docId "锚文本"))`
- 文献笔记内部的原文定位链接使用 `zotero://open-pdf/library/items/<pdfKey>?page=<n>&annotation=<annotationKey>`

---

## 7. 笔记内容模板

### 默认模板（中文版，含四层超链）

```markdown
📄 [在 Zotero 中打开 PDF](zotero://open-pdf/library/items/{{pdfKey}})

**作者**：{{authors}}
**发表年份**：{{year}}
**期刊/会议**：{{journal}}
**DOI**：[{{doi}}](https://doi.org/{{doi}})
**标签**：{{tags}}

## Abstract

{{abstract}}

## 研究问题

[待补充]

## 方法与实验

[待补充]
{{#blueAnnotations}}
- {{text}} [→]({{zoteroOpenURI}})
{{/blueAnnotations}}

## 核心发现

[待补充]
{{#yellowAnnotations}}
- {{text}} [→]({{zoteroOpenURI}})
{{/yellowAnnotations}}

## 关键引文

[待补充]
{{#redAnnotations}}
> {{text}}
> — [定位标注]({{zoteroOpenURI}})
{{/redAnnotations}}
{{#noteAnnotations}}
> **批注**：{{comment}}
> 原文："{{text}}" — [定位标注]({{zoteroOpenURI}})
{{/noteAnnotations}}

## 个人思考

[待补充]
{{#purpleAnnotations}}
- {{text}} [→]({{zoteroOpenURI}})
{{/purpleAnnotations}}

## 相关文献

[待补充]

## User Data {: custom-literature-block-type="user data"}

[此处为你的个人笔记，不会被自动刷新覆盖]
```

### 模板变量

| 变量 | 来源 | 示例 |
|------|------|------|
| `{{title}}` | zotero-item.js | Attention Is All You Need |
| `{{authors}}` | zotero-item.js | Vaswani et al. |
| `{{year}}` | zotero-item.js | 2017 |
| `{{journal}}` | zotero-item.js | NeurIPS |
| `{{doi}}` | zotero-item.js | 10.xxxx/xxxxx |
| `{{abstract}}` | zotero-item.js | The dominant sequence transduction models... |
| `{{tags}}` | zotero-item.js | transformer, attention |
| `{{itemKey}}` | Zotero 条目 key | BNQ6EZIN |
| `{{pdfKey}}` | PDF 附件 key | PARENTKEY |
| `{{citekey}}` | BBT 提供 | vaswani2017attention |
| `{{pdfFileLink}}` | note-builder.js 生成 | `zotero://open-pdf/library/items/PARENTKEY` |
| `{{pdfPageLink:N}}` | note-builder.js 生成 | `zotero://open-pdf/library/items/PARENTKEY?page=3` |
| `{{userNotes}}` | zotero-notes.js | 用户在 Zotero 中的笔记 |
| `{{annotations}}` | zotero-notes.js | 按颜色分组的 PDF 标注列表 |
| `{{annotations[].text}}` | 标注文本 | The Transformer allows... |
| `{{annotations[].comment}}` | 标注批注 | 这里提出了核心创新点 |
| `{{annotations[].color}}` | 标注颜色 | yellow, red, blue, green, purple |
| `{{annotations[].page}}` | 标注页码 | 5 |
| `{{annotations[].zoteroOpenURI}}` | 标注精准定位链接 | `zotero://open-pdf/...?page=5&annotation=KEY` |
| `{{fullTextSummary}}` | AI 分析 pdf-to-md 输出 | 全文摘要（200-500 字） |

### AI 生成笔记时的超链注入规则

SKILL.md 中指导 AI 遵循以下规则：

1. **顶部 PDF 入口**：笔记文档第一行必须包含 `📄 [在 Zotero 中打开 PDF](zotero://open-pdf/library/items/{{pdfKey}})`
2. **标注优先原则**：每个要点选择可用的最高精度链接：
   - 有 Zotero 标注 → L4 标注级 `?page=N&annotation=KEY`（最精准）
   - 无标注但知页码 → L3 页码级 `?page=N`
   - 无法定位 → L2 文件级（仅打开 PDF）
3. **标注按颜色归类**：
   - 🟡 黄色标注 → 核心发现
   - 🔴 红色标注 → 关键引文
   - 🔵 蓝色标注 → 方法与实验
   - 🟢 绿色标注 → 支撑材料
   - 🟣 紫色标注 → 个人思考/疑问
   - 📝 批注 → 关键引文（保留原文+评论）
4. **标注文本保留**：高亮原文用 inline code 或引用格式保留，后面跟定位链接
5. **无标注时降级**：若 Zotero 中无标注，基于 MinerU 全文 + 页码推断生成 L2/L3 链接

---

## 8. 配置

### 环境变量

| 变量 | 必须 | 说明 | 默认值 |
|------|------|------|--------|
| `ZOTERO_BASE_URL` | 否 | Zotero Local API 地址 | `http://localhost:23119` |
| `ZOTERO_API_KEY` | 否 | Zotero API Key（仅远程 API 需要，Local API 不需要） | - |
| `SIYUAN_BASE_URL` | 是 | 思源 API 地址 | `http://localhost:6806` |
| `SIYUAN_TOKEN` | 是 | 思源 API Token | - |
| `SIYUAN_SKILL_DIR` | 是 | siyuan-skill 安装目录 | - |
| `SIYUAN_DEFAULT_NOTEBOOK` | 是 | 默认笔记本 ID | - |
| `ZOTERO_LIBRARY_ID` | 否 | Zotero 库 ID | `1` |
| `LIT_NOTE_PATH` | 否 | 文献笔记存放路径 | `/References` |
| `LIT_NOTE_TEMPLATE` | 否 | 笔记模板语言 | `zh` |
| `MINERU_ENABLED` | 否 | 是否启用 PDF→MD（默认 true） | `true` |
| `ZOTERO_PDF_PAGE_OFFSET` | 否 | Zotero PDF 页码偏移，默认遵循插件实现 | `0` |
| `ZOTERO_SIYUAN_CACHE_DIR` | 否 | PDF→MD 与标注缓存目录 | `.cache/zotero-siyuan` |

### config.json

```json
{
  "zotero": {
    "baseUrl": "http://localhost:23119",
    "apiKey": "",
    "libraryID": 1
  },
  "siyuan": {
    "baseUrl": "http://localhost:6806",
    "token": "",
    "defaultNotebook": "",
    "skillDir": "/path/to/siyuan-skill"
  },
  "litNote": {
    "path": "/References",
    "template": "zh",
    "autoAppendUserData": true
  },
  "mineru": {
    "enabled": true,
    "command": "mineru-open-api",
    "mode": "flash"
  },
  "cache": {
    "dir": ".cache/zotero-siyuan",
    "refreshOnAnnotationChange": true
  }
}
```

---

## 9. 依赖关系

```
zotero-siyuan-skill
│
├── 外部依赖（零 npm 依赖，纯 Node.js 内置模块）
│   ├── http/https (Node.js 内置)
│   └── child_process (Node.js 内置)
│
├── 需要运行中的服务/工具
│   ├── Zotero 桌面端 (localhost:23119)
│   │   └── 需启用 Settings → Advanced → Allow local API
│   ├── SiYuan Note (localhost:6806)
│   ├── SiYuan API Token (手动配置)
│   └── mineru-open-api (npm install -g mineru-open-api, 用于 PDF→MD)
│
├── 依赖 siyuan-skill（子进程调用）
│   ├── scripts/lib/connector.js  →  HTTP 客户端模式参考
│   ├── scripts/create.js         →  lit-note-create.js 调用
│   ├── scripts/update.js         →  更新文档内容
│   ├── scripts/content.js        →  获取笔记内容
│   ├── scripts/block-insert.js   →  lit-note-append.js 调用
│   ├── scripts/block-update.js   →  lit-note-append.js 调用
│   ├── scripts/block-attrs.js    →  设置 custom-literature-key 等属性
│   ├── scripts/search.js         →  按标题搜索文献笔记
│   ├── scripts/info.js           →  获取文档元数据
│   └── scripts/exists.js         →  检查文献笔记是否已存在
│
├── 依赖 MinerU skill（PDF 转换）
│   └── `mineru-open-api flash-extract <pdf>` → Markdown 全文
│
└── 兼容 siyuan-plugin-citation
    ├── custom-literature-key 属性格式
    ├── custom-entry-data 属性格式
    └── User Data 区域标记
```

---

## 10. 实施计划

### Phase 1: 基础设施（预计 4-6 小时）

| 任务 | 产出 | 优先级 |
|------|------|--------|
| 创建项目骨架（SKILL.md, _meta.json, package.json） | 可加载的 skill | P0 |
| 实现 `scripts/lib/zotero-client.js` | Zotero Local API 客户端 | P0 |
| 实现 `scripts/zotero-status.js` | 连接检查 | P0 |
| 实现 `scripts/zotero-item.js` | 条目元数据获取（含 PDF 路径） | P0 |
| 实现 `scripts/zotero-items.js` | 条目列表 | P1 |
| 实现 `scripts/zotero-notes.js` | 笔记/标注获取（含页码） | P1 |
| 实现 `scripts/zotero-attachment.js` | PDF 附件路径获取 | P1 |
| 实现 `scripts/zotero-write-annotation.js` | Zotero PDF note 标注创建（含 siyuan:// 超链） | P0 |
| 实现 `scripts/pdf-to-md.js` | MinerU 封装，PDF→MD | P0 |
| 实现 `scripts/cache.js` | 转换结果与标注缓存管理 | P1 |

### Phase 2: 核心功能（预计 6-8 小时）

| 任务 | 产出 | 优先级 |
|------|------|--------|
| 实现 `scripts/lit-note-find.js` | 文献笔记查找 | P0 |
| 实现 `scripts/lit-note-create.js` | 文献笔记创建（含 PDF 超链注入） | P0 |
| 实现 `scripts/lib/note-builder.js` | 笔记模板渲染 + 超链生成 | P0 |
| 实现 `scripts/lib/siyuan-bridge.js` | siyuan-skill 子进程调用封装 | P0 |
| 实现 `scripts/lit-note-append.js` | 内容追加 | P0 |
| 实现 `scripts/ask-supplement.js` | 补充建议 | P1 |
| 编写 SKILL.md 完整指令 | AI 行为指南（含 PDF 超链规则） | P0 |

### Phase 2.5: 标注精准定位（预计 3-4 小时）

| 任务 | 产出 | 优先级 |
|------|------|--------|
| 解析 Zotero 标注结构 | `annotations.all/byColor` | P0 |
| 生成 L4 标注级 `zoteroOpenURI` | 精准跳转链接 | P0 |
| 颜色语义映射配置 | `annotationColorMap` | P1 |
| 标注变更检测 | 缓存失效策略 | P1 |

### Phase 3: 完善与测试（预计 4-6 小时）

| 任务 | 产出 | 优先级 |
|------|------|--------|
| 编写 references/workflow.md | 工作流文档 | P1 |
| 编写 references/template-guide.md | 模板定制指南 | P1 |
| 编写 examples/ | 使用示例 | P1 |
| 端到端测试 | 测试报告 | P1 |
| 边缘情况处理（无网络、Zotero 未运行、重复创建等） | 健壮的脚本 | P0 |

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Zotero API 变更 | 脚本失效 | 使用 API v3；版本检测；降级到文件读取 |
| siyuan-plugin-citation 属性格式变更 | 链接失效 | 增加兼容性检查脚本 |
| Zotero 未运行 | 无法获取数据 | 提前检查并给出明确提示 |
| 论文无摘要/元数据不完整 | 笔记质量下降 | 标注 `[待补充]`；提示用户手动补充 |
| 中文论文元数据格式不同 | 解析异常 | 增加中文期刊元数据适配 |
| AI 判断失误（不该补充时补充） | 笔记冗余 | `ask-supplement.js` 给出置信度；不确定时询问用户 |
| itemKey 与 pdfKey 混淆 | PDF/标注链接打不开 | 数据模型中强制区分 `itemKey`、`pdfKey`、`annotationKey` |
| Zotero 标注页码偏移 | 跳转页码不准 | 默认跟随插件实现，保留 `ZOTERO_PDF_PAGE_OFFSET` 配置 |
| MinerU 转换慢或失败 | 初始笔记缺少全文 | 使用缓存；失败时降级到摘要+标注+Zotero 笔记 |
| 标注变更后笔记过期 | 链接或内容不一致 | 标注快照 hash 检测，支持 `--refresh` 重建 |
| Zotero Local API 写标注失败 | 反向链接缺失 | 降级：仅在 SiYuan 笔记中保留 PDF 超链，不影响笔记创建 |
| siyuan:// 链接在 Zotero 中不可点击 | 反向链接不可用 | Zotero 不支持 siyuan:// 的自定义协议；提供替代的纯文本 docId 或 http 桥接 |
| 标注位置重叠 | UI 杂乱 | 提供 `--position` 参数可控偏移，避免同页多标注重叠 |

---

## 12. 验收标准

| 场景 | 验收条件 |
|------|---------|
| Zotero 连接 | Zotero 运行且 Local API 开启时，`zotero-status.js` 返回 success |
| 元数据获取 | 给定文献 `itemKey`，能返回标题、作者、年份、DOI、`pdfKey`、`pdfPath` |
| PDF 转换 | 给定 `pdfKey` 或 `itemKey`，能生成 Markdown 并写入缓存 |
| 标注获取 | 至少能识别 highlight、underline、note，并输出 `zoteroOpenURI` |
| 标注跳转 | SiYuan 中点击 `zotero://open-pdf/...&annotation=...` 能打开 Zotero PDF 对应标注 |
| 文献笔记创建 | 思源文档包含 `custom-literature-key`、`custom-entry-data`、`custom-zotero-pdf-key` |
| 插件兼容 | `siyuan-plugin-citation` 能通过 `custom-literature-key` 找到该文献笔记 |
| 智能补充 | 用户明确要求补充时，内容写入目标文献笔记 `User Data` 或指定章节 |
| 降级路径 | 无 MinerU、无标注、无 PDF 时仍能基于 Zotero 元数据创建基础笔记 |
| 反向标注创建 | 给定 `pdfKey`、`pageIndex`、`siyuan://` 链接，能在 Zotero PDF 上创建 note 标注 |
| 反向标注点击 | 在 Zotero PDF 上点击 note 标注，能通过 `siyuan://` 协议跳转到思源对应文档 |
| 标注去重 | 同一 `(pdfKey, pageIndex, noteKey)` 不会重复创建 |

---

## 13. 与现有生态的关系

```
                    ┌─────────────────────────┐
                    │    zotero-siyuan-skill   │ ← 本 skill
                    │    (AI 驱动的文献笔记)    │
                    └──────┬──────────┬───────┘
                           │          │
              ┌────────────┤          ├────────────────┐
              │ 调用       │ 提供     │ 兼容           │ 调用
              ▼            ▼          ▼                ▼
    ┌─────────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐
    │ siyuan-skill│ │ opencode │ │ siyuan-plugin│ │ MinerU   │
    │ CLI 脚本    │ │ AI 能力  │ │ -citation    │ │ PDF→MD   │
    └─────────────┘ └──────────┘ └──────────────┘ └──────────┘
```

**分工边界**：
- **MinerU**：PDF 转 Markdown，提供 AI 可读的全文——flash-extract 零配置
- **siyuan-skill**：通用的思源笔记操作（文档 CRUD、块操作、搜索）——子进程调用，不重复实现
- **siyuan-plugin-citation**：引用渲染、文献池管理、模板系统——兼容其数据格式
- **opencode AI**：内容生成、意图理解、补充判断——SKILL.md 指导
- **zotero-siyuan-skill（新）**：Zotero Local API 数据获取、PDF→MD 编排、文献笔记创建、`zotero://` PDF 超链注入、内容补充

---

*文档版本: v0.4 | 最后更新: 2026-06-24*
