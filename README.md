# zotero-siyuan-skill

AI 驱动的 Zotero 论文阅读辅助 skill —— 在思源笔记中自动生成结构化文献笔记，支持 PDF 全文分析、四层超链精准定位、反向标注。

## 依赖

| 依赖 | 说明 |
|------|------|
| [siyuan-plugin-citation](https://github.com/WingDr/siyuan-plugin-citation) | 思源引用插件，管理文献池和引用渲染。本 skill 笔记兼容其 `custom-literature-key` 和数据格式 |
| [siyuan-skill](https://github.com/dazexcl/siyuan-skill) | 思源笔记操作 CLI，本 skill 通过子进程调用其脚本 |
| Zotero 桌面端 | 需启用 Settings → Advanced → Allow local API |
| SiYuan Note | 思源笔记运行中 |
| mineru-open-api | PDF→Markdown 转换（`npm install -g mineru-open-api`） |

本 skill 与 **siyuan-plugin-citation** 的分工：
- 插件负责：引用插入、文献池管理、文献笔记模板渲染、引用样式
- 本 skill 负责：AI 驱动的论文阅读分析、User Data 区域内容生成、PDF 全文超链

**siyuan-skill 安装后无需任何配置**，本 skill 自动从以下路径发现：
- `../siyuan-skill`（同级目录）
- `~/.config/opencode/skills/siyuan-skill`
- `~/WorkSpace/Skills/siyuan-skill`

## 快速开始

```bash
# 检查连接
node scripts/zotero-status.js

# 获取 Zotero 论文信息
node scripts/zotero-item.js --key <itemKey>

# 为论文生成文献笔记（AI 驱动的完整流程见 SKILL.md）
node scripts/pdf-to-md.js --key <itemKey>
```

所有脚本均返回 JSON `{ success, data, message }`。

## 环境变量（全部可选）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SIYUAN_BASE_URL` | 思源 API 地址 | `http://localhost:6806` |
| `SIYUAN_TOKEN` | 思源 API Token（未设鉴权时留空） | 空 |
| `ZOTERO_BASE_URL` | Zotero Local API | `http://localhost:23119` |
| `ZOTERO_LIBRARY_ID` | Zotero 库 ID | `1` |

## 工作流

详见 [SKILL.md](./SKILL.md)，核心流程：

1. **生成笔记**：Zotero 元数据 → MinerU PDF→MD → AI 分析 → SiYuan 文献笔记
2. **智能补充**：用户提问 → 判断必要性 → 追加到笔记对应区域
3. **反向标注**：AI 发现关键点 → Zotero PDF 上创建 note 标注 → 链接回 SiYuan

## MinerU PDF 转换

统一使用 extract 模式。使用前需认证：

```bash
npm install -g mineru-open-api
mineru-open-api auth          # 注册 token: https://mineru.net/apiManage/token
```

### extract 模式输出

```bash
node scripts/pdf-to-md.js --key <itemKey> --output ./out/
```

输出 JSON 包含：

```json
{
  "markdown": "# 论文全文...",
  "contentPages": [
    { "text": "ABSTRACT", "pageIndex": 0, "level": 2, "bbox": [171,98,823,146] },
    { "text": "Deepfake detection remains...", "pageIndex": 0, "level": null, "bbox": [...] }
  ]
}
```

- `contentPages`：334 条文本块，`text` / `pageIndex` / `level` 字段供 AI 精确生成页级超链
- `bbox`：段落/句子在 PDF 页面上的像素坐标 `[x1, y1, x2, y2]`，精度到句子/段落级
- Zotero 协议当前只支持 `?page=N` 页级跳转；未来 Zotero 开放 Local API 写入后可利用 `bbox` 坐标创建 note 标注实现段落/句子级精准定位（`?page=N&annotation=KEY`）

## License

MIT
