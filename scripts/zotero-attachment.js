#!/usr/bin/env node
const ZoteroClient = require('./lib/zotero-client');
const ConfigManager = require('./lib/config');
const { createErrorResult, createSuccessResult } = require('./lib/result-helper');

async function main() {
  const args = process.argv.slice(2);
  const config = new ConfigManager().get();
  const client = new ZoteroClient(config.zotero.baseUrl);

  let itemKey = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--key' && args[i + 1]) itemKey = args[++i];
  }
  if (!itemKey) {
    console.log(JSON.stringify(createErrorResult('参数错误', '请提供 --key <itemKey>')));
    process.exit(1);
  }

  try {
    const children = await client.getChildren(itemKey);
    let pdfPath = null, pdfKey = null;

    if (Array.isArray(children)) {
      for (const child of children) {
        const cd = child.data || child;
        if (cd.itemType === 'attachment' && cd.contentType === 'application/pdf') {
          pdfKey = cd.key;
          // 优先使用 API 返回的 path
          pdfPath = cd.path || null;
          break;
        }
      }
    }

    // 如果 API 没有返回本地路径，通过 /file 端点获取
    if (pdfKey && !pdfPath) {
      try {
        pdfPath = await client.getAttachmentPath(pdfKey);
      } catch (_) { /* 仍为空则后续调用者自行降级 */ }
    }

    console.log(JSON.stringify(createSuccessResult({ pdfPath, pdfKey, itemKey })));
  } catch (e) {
    console.log(JSON.stringify(createErrorResult('获取失败', e.message)));
    process.exit(1);
  }
}

main();
