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
```

## 命令列表

| 脚本 | 说明 | 示例 |
|------|------|------|
| `zotero-status` | 检查 Zotero 连接 | `node {baseDir}/scripts/zotero-status.js` |
| `zotero-item` | 获取条目元数据 | `node {baseDir}/scripts/zotero-item.js --key <itemKey>` |
| `zotero-items` | 搜索/列出条目 | `node {baseDir}/scripts/zotero-items.js --q "transformer"` |
| `zotero-notes` | 获取笔记和 PDF 标注 | `node {baseDir}/scripts/zotero-notes.js --key <itemKey>` |
| `zotero-attachment` | 获取 PDF 附件路径 | `node {baseDir}/scripts/zotero-attachment.js --key <itemKey>` |
| `pdf-to-md` | PDF→Markdown | `node {baseDir}/scripts/pdf-to-md.js --key <itemKey> --siyuan-assets` |
| `siyuan-upload-images` | 上传图片到思源 | `node {baseDir}/scripts/siyuan-upload-images.js --dir <outputDir> --file "img1,img2"` |
| `zotero-write-annotation` | 创建 PDF 标注 | `node {baseDir}/scripts/zotero-write-annotation.js --pdf-key <key> --page <n> --comment "<html>"` |
| `lit-note-init` | 初始化笔记本配置 | `node {baseDir}/scripts/lit-note-init.js --notebook "文献库"` |
| `lit-note-find` | 查找文献笔记 | `node {baseDir}/scripts/lit-note-find.js --key <itemKey>` |
| `lit-note-create` | 创建文献笔记 | `node {baseDir}/scripts/lit-note-create.js --key <itemKey> --title "标题" --content-file <path> --notebook "<名称>" --entry-data "<json>" --pdf-key <pdfKey>` |
| `lit-note-append` | 追加/替换内容 | `node {baseDir}/scripts/lit-note-append.js --doc-id <id> --section "User Data" --content-file <path> --mode append\|replace --scope section\|document` |
| `ask-supplement` | 补充判断 | `node {baseDir}/scripts/ask-supplement.js --question "..." --note-content "..." --paper-title "..."` |

`lit-note-create` **必须用 `--content-file`**（内置读文件，彻底避免 shell 对 `$$` 和 `\` 的转义）。**严禁 `--content`**。

---

# 主流程：生成论文笔记

## ⚠️ 角色分工（违反即流程失败）

- **主 agent**：读 config、调 Zotero API、运行 pdf-to-md、启动子 agent、校验输出、调用 lit-note-create
- **子 agent**：必须用 `task` 工具启动专用 `zotero-note-writer` 子 agent，读论文 Markdown、分析全文、生成笔记正文
- **主 agent 绝对禁止自己在上下文中读/分析论文全文** — 这会导致上下文膨胀且遗漏规则

## ⚠️ 前置检查（步骤 [0]，必须先执行）

在获取任何 Zotero 数据之前，先执行以下检查：

1. **读取 `config.json`** 的 `litNote.notebookName`
2. 若值为空 → **中止流程**，告知用户：
   ```
   笔记目标笔记本未配置。请在 config.json 中设置 litNote.notebookName，或运行：
   node {baseDir}/scripts/lit-note-init.js --notebook "笔记本名"
   ```
3. 若值不为空 → 记录 `{notebookName}`，后续所有操作使用此值，**严禁覆盖**

## 步骤

```
用户："为这篇论文生成笔记"
     │
     ▼
[0] 前置：读 config.json → 确认 litNote.notebookName 非空 → 记为 {notebookName}
    若为空 → 中止并引导配置
     │
     ▼
[1] 确定目标论文：用户指定 itemKey 或从最近条目确认
    └─ zotero-items.js --limit 5
     │
     ▼
[2] 并行获取元数据（同一轮 tool call 同时发起 3 个 bash）
    ├─ zotero-item.js --key <key>       → title, authors, year, doi, abstract, pdfKey
    ├─ zotero-notes.js --key <key>      → PDF 标注（按颜色分组，含 zoteroOpenURI）
    └─ zotero-attachment.js --key <key> → PDF 本地路径
     │
     ▼
[3] PDF 全文分析 + 图片上传
    └─ pdf-to-md.js --key <itemKey> --siyuan-assets
       j.data.outputDir          → MinerU 输出目录
       j.data.mdPath             → 论文 Markdown 文件路径（全文只落盘，不进 stdout）
       j.data.contentPagesPath   → 内容→页码映射 JSON 文件
       j.data.imageManifestPath  → 图片清单/路径映射 JSON 文件
       j.data.imagesCopied       → 上传成功的图片数
       记录：mdPath、imgDir = <outputDir>/images/、contentPagesPath、imageManifestPath
     │
     ▼
[4] 启动子 agent 生成笔记
    使用 task 工具 + subagent_type='zotero-note-writer' + description="生成论文笔记"

    专用子 agent 的 prompt 前部已经内置稳定的模板和格式要求，用于命中缓存。
    主 agent 只传动态载荷，严禁把模板或格式规范复制进本轮上下文：

       论文路径：{mdPath}
       图片目录：{imgDir}
       元数据文件：/tmp/zotero-meta-<key>.json
       标注文件：/tmp/zotero-annotations-<key>.json
       页码映射文件：{contentPagesPath}
       图片清单文件：{imageManifestPath}
       PDF Key：{pdfKey}
       输出纯 Markdown 正文，无前缀后缀。

    子 agent 输出 → 笔记正文（纯 Markdown）
     │
     ▼
[5] 校验子 agent 输出

     1. write /tmp/zotero-note-<key>.md（写入子 agent 输出）
     2. 主 agent 只做创建前安全检查：输出非空、没有解释性前后缀、body 不含 `# 标题`、使用 `--content-file`
     3. 若怀疑模板或格式不合格，仍交回 `zotero-note-writer` 子 agent 自检并重修；主 agent 不复制模板/格式细则
     4. 全部通过后执行：
       lit-note-create.js --key <key> --title "{title}"
         --content-file /tmp/zotero-note-<key>.md
         --notebook "{notebookName}"
         --entry-data "<json>" --pdf-key <pdfKey>
      │
      ▼
[6] 反向标注（可选，用户要求时执行）
    └─ zotero-write-annotation.js --pdf-key <pdfKey> --page <n> --comment "..."
```

> 笔记模板和格式规范不写入主 agent 上下文。它们内置在 `.opencode/agents/zotero-note-writer.md` 的 prompt 前部，历史副本保存在 `{baseDir}/references/note-generation.md` 便于维护。

**内容传参**：严禁 `--content "..."`（bash 展开 `$$` → PID），必须 `--content-file`（`lit-note-create.js` 内置支持）。

---

# Q&A 智能补充（TODO 驱动）

```
用户提问
     │
     ▼
[1] 调用判断
    ask-supplement.js --question "..." --note-content "<md>" --paper-title "..."
    返回: { shouldSupplement, targetSection, targetIsTODO, fillAction, suggestion }
     │
     ▼
[2] 告知用户 → 确认
      │
      ▼
[3] 定位 + 填充
    lit-note-append.js --doc-id <id> --section "<targetSection>" --content-file <path> --mode replace|append --scope section
      │
      ▼
[4] 确认已填充

判断标准:
✅ 应补充：可填补 [待补充] | 用户明确要求 | 新分析发现
❌ 不补充：纯事实查询 | 已在笔记中 | 与当前论文无关
⚠️ 询问：不确定时，给出建议让用户选择
```

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
| Zotero 未运行 | 提示启动 Zotero 并启用 Settings → Advanced → Allow local API |
| MinerU 未安装 | `npm install -g mineru-open-api` |
| MinerU 认证失败 | `mineru-open-api auth`，注册: https://mineru.net/apiManage/token |
| 公式被 shell 破坏 | 检查是否误用 `--content`，改用 `--content-file` |
| 文献笔记已存在 | 告知 docId，询问打开阅读还是覆盖重建 |
| 无 PDF 附件 | 仅基于元数据和 Zotero 笔记生成基础笔记 |
| 无标注 | 降级为 L2/L3 链接，无反向标注 |

---

# 配置

所有配置项均可选，脚本自动从常见路径发现。

**依赖**: [siyuan-skill](https://github.com/dazexcl/siyuan-skill) — 自动从以下路径发现：
- `../siyuan-skill`
- `~/.config/opencode/skills/siyuan-skill`
- `~/WorkSpace/Skills/siyuan-skill`

**SIYUAN_DEFAULT_NOTEBOOK**: 自动调用 `siyuan-skill/scripts/notebooks.js` 获取，默认第一个笔记本。

**litNote.notebookName**: `config.json` 中配置目标笔记本（如 `"文献库"`）。**首次使用前必须设置**，否则工作流步骤 [0] 中止。

配置方式：
```bash
# 方式一：初始化脚本
node {baseDir}/scripts/lit-note-init.js --notebook "文献库"

# 方式二：直接编辑 config.json
{
  "litNote": { "notebookName": "文献库" }
}
```

**内容传参**：`lit-note-create.js` 支持 `--content-file <path>` 直接读文件。写入 `/tmp/zotero-note-<key>.md` 后传入路径即可。

**SIYUAN_TOKEN**: 可选。如需指定：`export SIYUAN_TOKEN="your-token"`

**覆盖端口/地址**：
```bash
export SIYUAN_BASE_URL="http://localhost:6808"
export ZOTERO_BASE_URL="http://localhost:23119"
```
