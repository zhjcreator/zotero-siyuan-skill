#!/usr/bin/env node
const SiyuanBridge = require('./lib/siyuan-bridge');
const ConfigManager = require('./lib/config');
const { createErrorResult, createSuccessResult } = require('./lib/result-helper');
const fs = require('fs');

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

  let docId = '', content = '', contentFile = '', section = 'User Data', mode = 'append', scope = 'section';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--doc-id' && args[i + 1]) docId = args[++i];
    if (args[i] === '--content' && args[i + 1]) content = args[++i];
    if (args[i] === '--content-file' && args[i + 1]) contentFile = args[++i];
    if (args[i] === '--section' && args[i + 1]) section = args[++i];
    if (args[i] === '--mode' && args[i + 1]) mode = args[++i];
    if (args[i] === '--scope' && args[i + 1]) scope = args[++i];
  }

  if (contentFile) {
    try { content = fs.readFileSync(contentFile, 'utf8'); }
    catch (e) { console.log(JSON.stringify(createErrorResult('文件读取失败', e.message))); process.exit(1); }
  }

  if (!docId || !content) {
    console.log(JSON.stringify(createErrorResult('参数错误', '请提供 --doc-id <id>，以及 --content <markdown> 或 --content-file <path>')));
    process.exit(1);
  }
  if (!['append', 'replace'].includes(mode)) {
    console.log(JSON.stringify(createErrorResult('参数错误', '--mode 仅支持 append 或 replace')));
    process.exit(1);
  }
  if (!['section', 'document'].includes(scope)) {
    console.log(JSON.stringify(createErrorResult('参数错误', '--scope 仅支持 section 或 document')));
    process.exit(1);
  }

  try {
    if (scope === 'document') {
      if (mode !== 'replace') {
        console.log(JSON.stringify(createErrorResult('参数错误', '--scope document 仅支持 --mode replace')));
        process.exit(1);
      }
      const updateRes = await bridge.updateDoc(docId, content);
      console.log(JSON.stringify(createSuccessResult({ docId, scope, mode, result: updateRes }, '文档已整体替换')));
      return;
    }

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
      const nextContent = `${docContent.trimEnd()}\n\n## ${section}\n\n${content}\n`;
      const updateRes = await bridge.updateDoc(docId, nextContent);
      console.log(JSON.stringify(createSuccessResult({
        docId,
        section,
        mode: 'created-new-section',
        result: updateRes
      }, `区域 "${section}" 不存在，已新建`)));
      return;
    }

    let sectionEndIndex = lines.length;
    for (let i = sectionLineIndex + 1; i < lines.length; i++) {
      if (headerPattern.test(lines[i])) { sectionEndIndex = i; break; }
    }

    const before = lines.slice(0, sectionLineIndex + 1);
    const oldSectionBody = lines.slice(sectionLineIndex + 1, sectionEndIndex).join('\n').trim();
    const after = lines.slice(sectionEndIndex);
    let nextSectionBody;
    if (mode === 'replace') {
      nextSectionBody = content.trim();
    } else {
      nextSectionBody = oldSectionBody ? `${oldSectionBody}\n\n${content.trim()}` : content.trim();
    }

    const nextContent = [...before, '', nextSectionBody, '', ...after].join('\n').replace(/\n{4,}/g, '\n\n\n');
    const updateRes = await bridge.updateDoc(docId, nextContent);
    console.log(JSON.stringify(createSuccessResult({
      docId,
      section,
      mode,
      scope,
      result: updateRes
    }, mode === 'replace' ? `已替换 "${section}" 区域` : `已追加到 "${section}" 区域`)));
  } catch (e) {
    console.log(JSON.stringify(createErrorResult('追加失败', e.message)));
    process.exit(1);
  }
}

main();
