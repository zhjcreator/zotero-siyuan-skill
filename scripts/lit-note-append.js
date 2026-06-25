#!/usr/bin/env node
const SiyuanBridge = require('./lib/siyuan-bridge');
const ConfigManager = require('./lib/config');
const { createErrorResult, createSuccessResult } = require('./lib/result-helper');

/**
 * 向文献笔记的指定区域追加或替换内容。
 * 通过解析 markdown 标题结构定位目标区域。
 */

async function main() {
  const args = process.argv.slice(2);
  const config = new ConfigManager().get();

  if (!config.siyuan.skillDir) {
    console.log(JSON.stringify(createErrorResult('配置错误', '请设置 SIYUAN_SKILL_DIR')));
    process.exit(1);
  }

  const bridge = new SiyuanBridge(config.siyuan.skillDir);

  let docId = '', content = '', section = 'User Data', mode = 'append';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--doc-id' && args[i + 1]) docId = args[++i];
    if (args[i] === '--content' && args[i + 1]) content = args[++i];
    if (args[i] === '--section' && args[i + 1]) section = args[++i];
    if (args[i] === '--mode' && args[i + 1]) mode = args[++i];
  }

  if (!docId || !content) {
    console.log(JSON.stringify(createErrorResult('参数错误', '请提供 --doc-id <id> 和 --content <markdown>')));
    process.exit(1);
  }

  try {
    const contentRes = await bridge.getContent(docId);
    if (!contentRes || !contentRes.success) {
      console.log(JSON.stringify(createErrorResult('获取失败', '无法获取文档内容: ' + (contentRes?.message || ''))));
      process.exit(1);
    }

    const docContent = contentRes.data?.content || contentRes.data || '';
    const lines = docContent.split('\n');
    let sectionLineIndex = -1;
    const sectionPattern = new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`);
    const headerPattern = /^##\s+/;

    for (let i = 0; i < lines.length; i++) {
      if (sectionPattern.test(lines[i])) {
        sectionLineIndex = i;
        break;
      }
    }

    if (sectionLineIndex < 0) {
      const insertRes = await bridge.insertBlock(`## ${section}\\n\\n${content}`, docId);
      console.log(JSON.stringify(createSuccessResult({
        section,
        mode: 'created-new-section',
        blocks: insertRes.data
      }, `区域 "${section}" 不存在，已新建`)));
      return;
    }

    let insertAfterIndex = sectionLineIndex;
    for (let i = sectionLineIndex + 1; i < lines.length; i++) {
      if (headerPattern.test(lines[i])) break;
      insertAfterIndex = i;
    }

    const prevContent = lines[insertAfterIndex];
    let newContent;
    if (mode === 'replace') {
      newContent = content;
    } else {
      newContent = prevContent.trim() ? `${prevContent}\\n\\n${content}` : content;
    }

    const insertRes = await bridge.insertBlock(newContent, docId);
    console.log(JSON.stringify(createSuccessResult({
      section,
      mode,
      blocks: insertRes.data
    }, `已追加到 "${section}" 区域`)));
  } catch (e) {
    console.log(JSON.stringify(createErrorResult('追加失败', e.message)));
    process.exit(1);
  }
}

main();
