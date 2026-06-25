#!/usr/bin/env node
const ZoteroClient = require('./lib/zotero-client');
const ConfigManager = require('./lib/config');
const { createErrorResult, createSuccessResult } = require('./lib/result-helper');

/**
 * ⚠️ Zotero Local API 不支持写入（只支持 GET）。
 * 要创建 PDF 标注，需要以下任一方式：
 *   1. Zotero Web API（需要 API Key + 联网）
 *   2. debug-bridge 插件（最灵活，需安装插件）
 *   3. Zotero 7 将来可能支持 Local API 写入
 *
 * 本脚本检测可用方式并给出建议，在支持写入的 API 可用时执行创建。
 */

async function main() {
  const args = process.argv.slice(2);
  const config = new ConfigManager().get();
  const client = new ZoteroClient(config.zotero.baseUrl);

  let pdfKey = '', pageIndex = 0, pageLabel = '', comment = '', color = '#ffd400';
  let posX = 300, posY = 10;
  const useWebAPI = args.includes('--web-api');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pdf-key' && args[i + 1]) pdfKey = args[++i];
    if (args[i] === '--page' && args[i + 1]) pageIndex = parseInt(args[++i], 10);
    if (args[i] === '--page-label' && args[i + 1]) pageLabel = args[++i];
    if (args[i] === '--comment' && args[i + 1]) comment = args[++i];
    if (args[i] === '--color' && args[i + 1]) color = args[++i];
    if (args[i] === '--position-x' && args[i + 1]) posX = parseInt(args[++i], 10);
    if (args[i] === '--position-y' && args[i + 1]) posY = parseInt(args[++i], 10);
  }

  if (!pdfKey || !comment) {
    console.log(JSON.stringify(createErrorResult('参数错误', '请提供 --pdf-key <key> 和 --comment <html>')));
    process.exit(1);
  }

  const displayPage = pageLabel || String(pageIndex + 1);
  const position = JSON.stringify({ pageIndex, rects: [[posX, posY, posX + 16, posY + 16]] });

  const body = {
    itemType: 'annotation',
    parentItem: pdfKey,
    annotationType: 'note',
    annotationText: '',
    annotationComment: comment,
    annotationPosition: position,
    annotationColor: color,
    annotationPageLabel: displayPage,
    tags: []
  };

  // Try Local API POST (will fail on current Zotero with 501 or method not allowed)
  try {
    const result = await client.createItems(body);
    console.log(JSON.stringify(createSuccessResult({
      annotationKey: result.success?.[0] || result.key,
      zoteroOpenURI: `zotero://open-pdf/library/items/${pdfKey}?page=${pageIndex}`,
      method: 'local-api'
    }, '标注创建成功')));
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('501') || msg.includes('405') || msg.includes('Not Implemented') || msg.includes('Method Not Allowed')) {
      console.log(JSON.stringify(createErrorResult('API 不支持写入',
        'Zotero Local API 当前版本仅支持 GET 读取，不支持写入。\n' +
        '解决方案：\n' +
        '  1. 使用 Zotero Web API（需配置 ZOTERO_API_KEY）: 添加 --web-api 参数\n' +
        '  2. 安装 Zotero debug-bridge 插件后可写入\n' +
        '  3. 等待 Zotero 未来版本支持 Local API 写入\n' +
        '暂时已跳过反向标注，笔记仍会正常创建。')));
    } else {
      console.log(JSON.stringify(createErrorResult('创建失败', e.message)));
    }
    process.exit(1);
  }
}

main();
