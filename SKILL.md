---
name: "zotero-siyuan-skill"
description: "Zotero 论文阅读辅助：自动在思源中生成文献笔记，支持 PDF 全文分析、四层超链定位、反向标注。当用户阅读 Zotero 中论文时调用。"
skillType: "cli"
homepage: "https://github.com/WingDr/siyuan-plugin-citation"
metadata: {"openclaw":{"emoji":"📚","requires":{"bins":["node","mineru-open-api"],"dependencies":["siyuan-skill"]}}}
---

## 依赖

| 依赖 | 说明 |
|------|------|
| siyuan-skill | 思源笔记操作 CLI |
| Zotero 桌面端 | 需启用 Settings → Advanced → Allow local API |
| SiYuan Note | 思源笔记运行中 |
| mineru-open-api | PDF→Markdown（`npm install -g mineru-open-api`）+ **必须认证**（`mineru-open-api auth`） |

## 快速开始

```bash
node {baseDir}/scripts/<command>.js [options]
node {baseDir}/scripts/<command>.js --help  # 查看命令帮助
```

## 命令列表

### Zotero 数据获取

| 脚本 | 说明 | 示例 |
|------|------|------|
| `zotero-status` | 检查 Zotero 连接 | `node {baseDir}/scripts/zotero-status.js` |
| `zotero-item` | 获取条目元数据 | `node {baseDir}/scripts/zotero-item.js --key <itemKey>` |
| `zotero-items` | 搜索/列出条目 | `node {baseDir}/scripts/zotero-items.js --q "transformer"` |
| `zotero-notes` | 获取笔记和 PDF 标注 | `node {baseDir}/scripts/zotero-notes.js --key <itemKey>` |
| `zotero-attachment` | 获取 PDF 附件路径 | `node {baseDir}/scripts/zotero-attachment.js --key <itemKey>` |

### PDF 处理

| 脚本 | 说明 | 示例 |
|------|------|------|
| `pdf-to-md` | PDF→Markdown | `node {baseDir}/scripts/pdf-to-md.js --key <itemKey>` |
| `zotero-write-annotation` | 创建 PDF 标注 | `node {baseDir}/scripts/zotero-write-annotation.js --pdf-key <key> --page <n> --comment "<html>"` |

### 文献笔记操作

| 脚本 | 说明 | 示例 |
|------|------|------|
| `lit-note-find` | 查找文献笔记 | `node {baseDir}/scripts/lit-note-find.js --key <itemKey>` |
| `lit-note-create` | 创建文献笔记 | `node {baseDir}/scripts/lit-note-create.js --key <itemKey> --title "标题" --content "<md>" --entry-data "<json>"` |
| `lit-note-append` | 追加内容 | `node {baseDir}/scripts/lit-note-append.js --doc-id <id> --section "User Data" --content "<md>"` |

### AI 辅助

| 脚本 | 说明 | 示例 |
|------|------|------|
| `ask-supplement` | 补充判断 | `node {baseDir}/scripts/ask-supplement.js --question "..." --note-content "..." --paper-title "..."` |

---

# 关键规则

## 工作流：生成论文笔记

```
用户："为这篇论文生成笔记"
     │
     ▼
[1] 确定目标论文：用户指定 itemKey 或从最近条目中确认
    └─ zotero-items.js --limit 5  # 列出最近条目
     │
     ▼
[2] 获取元数据和附件
    ├─ zotero-item.js --key <key>         → title, authors, doi, pdfKey...
    ├─ zotero-notes.js --key <key>        → PDF 标注（按颜色分组）
    └─ zotero-attachment.js --key <key>   → PDF 本地路径
     │
     ▼
[3] PDF 全文分析
    └─ pdf-to-md.js --key <itemKey>
       j.data.markdown 含完整 Markdown（图片路径为 images/xxx.jpg）
       j.data.contentPages 提供内容→页码映射

[4] AI 分析 + 选图
    生成笔记时，从 Markdown 中选择关键图（架构图、实验结果），
    记录其文件名（如 images/015da6...jpg → 015da6...jpg）

[4.5] 按需上传图片
    └─ siyuan-upload-images.js --dir <mineru-output> --file "img1,img2"
       只上传笔记中引用的图片到 ~/SiYuan/assets/
       笔记中引用路径为 assets/xxx.jpg
     │
     ▼
[4] AI 分析生成笔记内容
    输入：元数据 + Markdown 全文 + PDF 标注列表
    输出：结构化 Markdown（遵循下方模板）

    标注按颜色归类：
    🟡黄色→核心发现 | 🔴红色→关键引文 | 🔵蓝色→方法 | 🟣紫色→思考 | 📝批注→关键引文

    每个要点根据精度选择超链：
      有标注→L4 标注级 ?page=N&annotation=KEY
      知页码→L3 页码级 ?page=N
      未知→L2 文件级
     │
     ▼
[5] 创建/更新文献笔记
    ⚠️ 内容必须通过文件传入，避免 bash 展开 $ 变量破坏公式：
    1. 将笔记内容写入临时文件: write /tmp/zotero-note-<key>.md
    2. lit-note-create.js --key <key> --title "标题"
          --content-file /tmp/zotero-note-<key>.md
          --entry-data "<json>" --pdf-key <pdfKey>

    注意: 不要用 --content 传内容（bash 会把 $E、$f' 等当变量展开，破坏公式）
     │
     ▼
[6] 反向标注（可选，用户要求时执行）
    └─ zotero-write-annotation.js --pdf-key <pdfKey> --page <n>
         --comment "<p>核心发现...<br/><a href='siyuan://blocks/<docId>'>打开思源笔记</a></p>"
```

## 工作流：Q&A 智能补充（TODO 驱动）

```
用户提问
     │
     ▼
[1] 调用判断
    ask-supplement.js --question "..." --note-content "<md>" --paper-title "..."
    返回: { shouldSupplement, targetSection, targetIsTODO, fillAction, suggestion }
     │
     ▼
[2] 告知用户
    "这个回答涉及「{targetSection}」，该区域当前是 [待补充]。
     要补充到笔记吗？[y]"
     │
     ▼
[3] 用户确认 → 定位 + 填充
    ├─ lit-note-find.js --key <key>
    ├─ 生成 markdown 内容
    └─ lit-note-append.js --doc-id <id>
         --section "<targetSection>"
         --content "<md>"
         --mode replace|append
     │
     ▼
[4] 确认已填充

判断标准:
✅ 应补充：可填补 [待补充] | 用户明确要求 | 新分析发现
❌ 不补充：纯事实查询 | 已在笔记中 | 与当前论文无关
⚠️ 询问：不确定时，给出建议让用户选择
```

---

# 笔记模板与区域分工

## 插件管理的区域（siyuan-plugin-citation 自动生成和刷新）

这部分由插件管理，**我们不应该手动创建或修改**。当用户通过插件插入引用后，插件自动生成：

```markdown
---

**Title**:	{{title}}

**Author**:	{{authorString}}

**Year**:	{{year}}

---

# 📌 Abstract

{{abstract}}

# 📂 Select on Zotero

[在 Zotero 中定位]({{zoteroSelectURI}})

# 📎 Files

{{files}}

# 📝 Zotero Notes

{{note}}
```

> 插件刷新时会覆盖以上内容，保留 User Data 区域不变。

## AI 管理的区域（放在 User Data 内，AI/ML 论文专用模板）

```markdown
### 🎯 一句话总结
[用一句话概括这篇论文的核心贡献，20 字以内]

### 🏗️ 模型架构
**名称**：[模型名称，如 Veritas]
**整体框架**：[pipeline/end-to-end/two-stage 等，结构图用文字描述]
**核心组件**（每个附 [第N页](zotero://...) 链接）：

- **Backbone**：[ViT-B/16, ResNet-50, CLIP 等]，输入尺寸/通道
- **特征提取**：[关键模块1]：[作用 + 输入输出维度] [第N页]
- **核心创新模块**：[注意力机制/Adapter/LoRA 等]：[详细设计，不少于 80 字] [第N页]
- **Head/解码器**：[分类头/检测头/生成头]：[输出维度，激活函数]
- **损失函数**：

$$
\mathcal{L} = \mathcal{L}_{1} + \lambda \mathcal{L}_{2}
$$
各分项含义：[...]

**参数量/计算量**：[#params, FLOPs, 推理速度]

### 📊 训练策略
- **数据集**：[名称, 规模, 来源] [第N页]
- **预处理**：[图像尺寸, 归一化, 增强方法]
- **优化器**：[AdamW/SGD], lr=[], batch_size=[], epochs=[]
- **学习率调度**：[cosine/step/warmup]
- **正则化**：[dropout, weight decay, label smoothing]
- **硬件/时间**：[GPU 型号, 训练时长]

### 📈 核心结果
| 任务 | 数据集 | 指标 | 本文 | SOTA | [第N页] |
|------|--------|------|------|------|------|
| ... | ... | ... | ... | ... | [第N页] |

**关键消融**：[哪些模块贡献最大] [第N页]

### 🔍 关键引文
> "原文引用"
> — [第N页](zotero://...)

### 🤔 思考与疑问
- 优点：[...]
- 局限：[...]
- 可借鉴点：[...]
- 疑问：[...]
```

> **模板要点**：模型架构是核心，必须详细到模块级（backbone/neck/head/损失函数），每项标注页码超链。结果/训练用表格。公式正常写 KaTeX 即可。块级公式前后必须有空行。
> **图片**：从 MinerU Markdown 中选关键图 → 用 `siyuan-upload-images.js --dir <out> --file "img1,img2"` 按需上传 → 笔记中 `![描述](assets/xxx.jpg)` 引用。

---

# 格式规范（继承 siyuan-skill）

| 场景 | 正确格式 | 错误格式 |
|------|---------|---------|
| 内部链接 | `((id "锚文本"))` | `[文本](id)` ❌ |
| 换行 | `\\n` | 直接换行 |
| 段落分隔 | `\\n\\n` | 单个 \\n |
| 文档标题 | 通过 create.js 传参 | `# 标题` 写在 body ❌ |

> 完整规范参考 siyuan-skill 的 format-standard.md

---

# 补充判断标准

| 应补充 | 不补充 | 询问用户 |
|--------|--------|---------|
| 用户说"记下来""补充" | 纯事实查询（发表年/作者） | 不确定是否相关 |
| 新理解/分析/总结 | 操作性问题（怎么打开） | 内容可能有争议 |
| 论文间关联发现 | 笔记中已有相同内容 | 涉及个人观点 |

---

# 关键区分

| 概念 | 示例 | 用途 |
|------|------|------|
| `itemKey` | BNQ6EZIN | 文献条目 key，用于 `custom-literature-key` |
| `pdfKey` | PARENTKEY | PDF 附件 key，用于 `zotero://open-pdf` |
| `annotationKey` | HIGHLIGHT01 | 标注 key，用于 L4 精准定位 |
| `docId` | 20240601120000-abc1234 | 思源文档 ID，用于 `siyuan://` 链接 |

**重要**：`itemKey` 和 `pdfKey` 几乎总是不同，不能混用。

---

# 错误处理

| 错误 | 处理 |
|------|------|
| Zotero 未运行 | 提示用户：启动 Zotero 并确保 Settings → Advanced → Allow local API 已启用 |
| MinerU 未安装 | 提示：`npm install -g mineru-open-api` |
| PDF 超 10MB | 提示：改用 `mineru-open-api extract`（需 token）或仅用元数据生成笔记 |
| 文献笔记已存在 | 告知 docId，询问是打开阅读还是覆盖重建 |
| 无 PDF 附件 | 仅基于元数据和 Zotero 笔记生成基础笔记 |
| 无标注 | 降级为 L2/L3 链接，无反向标注 |

---

# 配置

所有配置项均为可选，脚本会自动从常见路径发现依赖和默认值。

**依赖**: [siyuan-skill](https://github.com/dazexcl/siyuan-skill) — 自动从以下路径发现：
- `../siyuan-skill`（本 skill 同级目录）
- `~/.config/opencode/skills/siyuan-skill`
- `~/WorkSpace/Skills/siyuan-skill`

**SIYUAN_DEFAULT_NOTEBOOK**: 自动调用 `siyuan-skill/scripts/notebooks.js` 获取，默认使用第一个笔记本。

**SIYUAN_TOKEN**: 可选。思源未设置访问鉴权时无需配置。如需指定：
```bash
export SIYUAN_TOKEN="your-token"
```

**覆盖默认端口/地址**：
```bash
export SIYUAN_BASE_URL="http://localhost:6808"  # 如端口非 6806
export ZOTERO_BASE_URL="http://localhost:23119"
```
