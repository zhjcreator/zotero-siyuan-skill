# zotero-siyuan-skill 笔记测试问题分析

> 测试论文: Veritas (H5CYQU4Q) | 日期: 2026-06-25

---

## 问题 1: PDF 文件路径解析失败 ✅ 已修复

### 现象
PDF 实际存在于 `Zotero/storage/L9GLXM59/...pdf`，但 API 返回 `cd.path: null`。

### 修复
- `lib/zotero-client.js` 新增 `getAttachmentPath(itemKey)` 方法，通过 Zotero Local API `/items/<pdfKey>/file` 端点（返回 302 到 `file://`）获取完整本地路径
- `zotero-attachment.js` 和 `pdf-to-md.js` 均增加 `/file` 端点回退逻辑
- 验证：成功解析 `/Users/zhj/Zotero/storage/L9GLXM59/Tan 等 - 2026 - Veritas Generalizable deepfake detection via pattern-aware reasoning.pdf`

---

## 问题 2: MinerU 大文件 + 图片处理 ⚠️ 部分

### 现象
- 本论文 PDF 16.8MB，超过 `flash-extract` 的 10MB 限制
- MinerU 提取的图片未集成到笔记

### 修复
- `pdf-to-md.js` 支持 `--mode extract` 参数（需 mineru token）
- 文件超限时给出明确的升级指引（注册 token → 认证 → 使用 extract 模式）
- 已支持 `--output` 参数将 MinerU 输出（含图片）写入指定目录
- 大文件自动提示：`mineru-open-api extract --language en --output ./out/`

### 待办
- 图片自动导入 SiYuan assets 目录并更新 Markdown 路径

---

## 问题 3: 删除保护阻止笔记覆盖 ✅ 已修复

### 修复
- `lit-note-create.js` 的 `--force` 模式改为：调用 `siyuan-skill update.js` 直接覆写文档内容，不执行 delete → create
- 属性设置改为直接调用 `/api/attr/setBlockAttrs` HTTP API，不再依赖 siyuan-skill 的 `block-attrs.js`
- 未覆盖区域自动删除旧内容，覆盖区域完整替换

---

## 问题 4: block-attrs.js 的 entry-data JSON 被截断 ✅ 已修复

### 修复
- `lit-note-create.js` 中属性设置改为直接 HTTP POST `/api/attr/setBlockAttrs`，完全绕过 siyuan-skill 的 `block-attrs.js` 及其逗号解析缺陷
- 验证：`{"title":"Veritas","author":"Tan et al.","year":2026,"doi":"...","type":"preprint"}` 完整存储（105 chars）

---

## 问题 5: 缺少 Zotero 标注的可视化处理 📋 后续

### 现状
标注超链已支持 L4 级别（`zotero://open-pdf/...?page=N&annotation=KEY`），但缺少标注截图嵌入。

### 待实现
- `zotero-notes.js` 集成 `annotationPosition` + page screenshot
- 标注截图导入 SiYuan assets 目录

---

## 其他改进

- **笔记语言规范**：SKILL.md 明确要求笔记使用中文（标题、分析、描述），原文引用保留原始语言
- **TODO 驱动补充**：`ask-supplement.js` 重写为 TODO 检测 + 区域匹配 + 重复检测 + `fillAction` 返回可执行步骤
- **`zotero-items.js`**：过滤 notes/attachments/annotations，只返回文献，使用 `/items/top` 端点
- **`zotero-write-annotation.js`**：检测 Local API 写入限制，明确告知当前不支持并给出替代方案

---

---

## 问题 6: `pdf-to-md.js` 文件大小检查顺序有误

### 现象
`pdf-to-md.js` 在 L69 检查 `fileSizeMB > 10` 并直接退出，而 mode 选择（`flash` vs `extract`）在 L77-80。超过 10MB 的文件即使使用 `extract` 模式（无此限制）也会被提前拦截。

```js
// L69: 文件大小检查在模式选择之前
if (fileSizeMB > 10) {
  // 直接退出, 不管 mode 是否为 extract
}

// L77: 模式选择在后面, 永远不会执行
const mode = config.mineru.mode || 'flash';
```

### 建议修复
将文件大小检查移到模式判断之后，`flash-extract` 模式检查 10MB 限制，`extract` 模式放开限制或警告。

---

## 问题 7: 图片自动集成流程缺失

### 现象
MinerU 提取的图片 → 复制到 siyuan `data/assets/` → 笔记内引用，整条链路完全手动：
1. 手动 `cp` 图片到 `/Users/zhj/SiYuan/data/assets/`
2. 手动在 Markdown 中写 `assets/image-name.jpg` 引用
3. 无自动触发 siyuan 资产索引刷新

### 建议修复
- `pdf-to-md.js` 增加 `--siyuan-assets` 参数，自动复制图片到 `{dataDir}/assets/` 并替换 Markdown 中相对路径为 `assets/` 前缀
- 或新增 `lit-note-assets.js` 脚本，负责将 MinerU 输出目录中的图片同步到 siyuan

---

## 问题 8: `lit-note-create --force` 无法覆盖 ✅ 已修复

### 修复
- `--force` 模式下先查重，若文档已存在则调用 `siyuan-skill update.js` 更新内容（而非 delete+create）
- 属性更新改为直接 HTTP API `/api/attr/setBlockAttrs`，无需删除保护授权

---

## 问题 9: `block-attrs.js` JSON 值截断 ⚠️ 已绕过

### 修复
- `lit-note-create.js` 中属性设置改为直接 HTTP POST `/api/attr/setBlockAttrs`，完全绕过 `block-attrs.js` 的 parseAttributes 逗号分割缺陷
- `block-attrs.js`（siyuan-skill）本身的 bug 未修复，但本 skill 不再依赖它

---

## 问题 10: 思源图片索引未自动刷新 📋 后续

### 说明
图片复制到 `SiYuan/data/assets/` 后需手动刷新或等待定时同步。可调用 `/api/asset/rescanUnusedAssets` 触发刷新，但 API 行为未充分测试，暂列为后续。

---

## 总结

| # | 问题 | 严重度 | 状态 |
|---|------|--------|------|
| 1 | PDF 路径解析 | 🔴 高 | ✅ 已修复 |
| 2 | MinerU 大文件 + 图片 | 🟡 中 | ✅ 已修复（文件大小检查顺序修正 + --siyuan-assets 自动复制图片） |
| 3 | 笔记覆盖被阻止 | 🟡 中 | ✅ 已修复 |
| 4 | entry-data JSON 截断 | 🟡 中 | ✅ 已修复（HTTP API 绕过） |
| 5 | 标注截图 | 🔵 低 | 📋 后续 |
| 6 | pdf-to-md 大小检查顺序 | 🟡 中 | ✅ 已修复（支持 --mode 参数 + flash 超 10MB 自动降级 extract） |
| 7 | 图片自动集成流程 | 🟡 中 | ✅ 已修复（--siyuan-assets 参数） |
| 8 | --force 不能真正覆盖 | 🟡 中 | ✅ 已修复（update.js 覆盖） |
| 9 | block-attrs JSON 截断（脚本层） | 🟡 中 | ⚠️ 已绕过（不依赖 block-attrs.js） |
| 10 | siyuan 图片索引未刷新 | 🔵 低 | 📋 后续 |

---

## 开发者反馈跟进（2026-06-26）

### 已处理

- `zotero-note-writer` 模板强制顺序调整为：研究问题 → 核心创新 → 架构与逐组件计算流程 → loss → 训练/实验。
- loss 说明细化：每个 loss 项必须写作用、公式、约束对象、优化目标、贡献能力、使用阶段、权重/缺失信息。
- 数据流不再作为独立大段，改为嵌入每个架构组件的 `计算流程` 子项。
- `pdf-to-md.js` stdout 不再返回完整 Markdown，只返回 `mdPath`、`contentPagesPath`、`imageManifestPath`、计数和摘要字段。
- `pdf-to-md.js` 写出 `image-manifest.json`，传递图片文件、Markdown 引用路径、是否上传和是否被 Markdown 引用。
- `lit-note-append.js` 支持 `--content-file`，并支持 `--scope section|document` 与 `--mode append|replace`。

### 外部反馈

- `apply_patch` 创建 `/tmp/...` 时显示为 `tmp/...` 的路径歧义属于 opencode 工具层显示问题，本仓库无法修复，建议反馈给 opencode 工具维护方。
