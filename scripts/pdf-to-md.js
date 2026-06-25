#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ConfigManager = require('./lib/config');
const { createErrorResult, createSuccessResult } = require('./lib/result-helper');

/** 通过思源 API 上传文件到 data 目录 */
function siyuanPutFile(siyuanBaseUrl, siyuanToken, filePath, fileBuffer, filename) {
  return new Promise((resolve) => {
    const boundary = '----SiYuanBoundary' + Date.now();
    const header = Buffer.from(
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="path"\r\n\r\n' +
      filePath + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="isDir"\r\n\r\n' +
      'false\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="modTime"\r\n\r\n' +
      Math.floor(Date.now() / 1000) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n' +
      'Content-Type: image/jpeg\r\n\r\n'
    );
    const footer = Buffer.from('\r\n--' + boundary + '--\r\n');
    const body = Buffer.concat([header, fileBuffer, footer]);

    const url = new URL('/api/file/putFile', siyuanBaseUrl);
    const req = require('http').request({
      method: 'POST', hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Authorization': `Token ${siyuanToken}`, 'Content-Length': body.length }
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { const r = JSON.parse(d); resolve(r.code === 0); } catch (_) { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.write(body); req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  const config = new ConfigManager().get();

  let pdfPath = '', itemKey = '', outputDir = '', siyuanAssets = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pdf' && args[i + 1]) pdfPath = args[++i];
    if (args[i] === '--key' && args[i + 1]) itemKey = args[++i];
    if (args[i] === '--output' && args[i + 1]) outputDir = args[++i];
    if (args[i] === '--siyuan-assets') siyuanAssets = true;
  }

  if (!config.mineru.enabled) {
    console.log(JSON.stringify(createErrorResult('已禁用', 'MinerU 转换已通过配置禁用')));
    process.exit(1);
  }
  if (!pdfPath && !itemKey) {
    console.log(JSON.stringify(createErrorResult('参数错误', '请提供 --pdf <path> 或 --key <itemKey>')));
    process.exit(1);
  }

  // 通过 itemKey 获取 PDF 路径
  if (!pdfPath && itemKey) {
    const ZoteroClient = require('./lib/zotero-client');
    const client = new ZoteroClient(config.zotero.baseUrl);
    try {
      const children = await client.getChildren(itemKey);
      let pdfKey = null;
      if (Array.isArray(children)) {
        for (const child of children) {
          const cd = child.data || child;
          if (cd.itemType === 'attachment' && cd.contentType === 'application/pdf') {
            pdfKey = cd.key; pdfPath = cd.path || null; break;
          }
        }
      }
      if (pdfKey && !pdfPath) {
        try { pdfPath = await client.getAttachmentPath(pdfKey); } catch (_) {}
      }
      if (!pdfPath) {
        console.log(JSON.stringify(createErrorResult('无PDF', '该 Zotero 条目有 PDF 附件但无法获取本地路径')));
        process.exit(1);
      }
    } catch (e) {
      console.log(JSON.stringify(createErrorResult('获取失败', e.message)));
      process.exit(1);
    }
  }

  if (!fs.existsSync(pdfPath)) {
    console.log(JSON.stringify(createErrorResult('文件不存在', `PDF 文件不存在: ${pdfPath}`)));
    process.exit(1);
  }

  const stat = fs.statSync(pdfPath);
  const fileSizeMB = stat.size / (1024 * 1024);

  // 必须指定输出目录
  if (!outputDir) {
    outputDir = path.join(config.cache.dir, crypto.createHash('md5').update(pdfPath).digest('hex').substring(0, 8));
  }
  fs.mkdirSync(outputDir, { recursive: true });

  try {
    console.error(`MinerU extract 转换中... (${fileSizeMB.toFixed(1)}MB)`);
    const result = spawnSync(config.mineru.command, [
      'extract', pdfPath, '--language', 'en', '--output', outputDir, '-f', 'md,json'
    ], {
      encoding: 'utf8', timeout: 900000, maxBuffer: 50 * 1024 * 1024
    });
    if (result.error) throw result.error;

    // 读取 markdown（文件名为原始 PDF 名）
    let markdown = '';
    const mdFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.md'));
    if (mdFiles.length > 0) {
      markdown = fs.readFileSync(path.join(outputDir, mdFiles[0]), 'utf8');
    }

    // 解析 content_list.json → 内容→页码映射
    let contentPages = [];
    for (const f of fs.readdirSync(outputDir)) {
      if (f.endsWith('.json')) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(outputDir, f), 'utf8'));
          const list = Array.isArray(raw) ? raw : (raw.data || []);
          if (Array.isArray(list)) {
            contentPages = list
              .filter(c => c.type === 'text' && c.text && c.page_idx != null)
              .map(c => ({ text: c.text.substring(0, 200), pageIndex: c.page_idx, level: c.text_level }));
          }
        } catch (_) {}
        break;
      }
    }

    if (!markdown.trim()) {
      console.log(JSON.stringify(createErrorResult('转换结果为空', 'MinerU 未返回内容')));
      process.exit(1);
    }

    // 通过思源 API 上传图片（直接 cp 不注册到思源索引，图片不显示）
    let imagesCopied = 0;
    let markdownOut = markdown;
    if (siyuanAssets) {
      const imgDir = path.join(outputDir, 'images');
      const imgRoot = fs.existsSync(imgDir) ? imgDir : outputDir;
      const imgFiles = fs.readdirSync(imgRoot).filter(f => /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(f));
      for (const f of imgFiles) {
        try {
          const imgData = fs.readFileSync(path.join(imgRoot, f));
          const ok = await siyuanPutFile(config.siyuan.baseUrl, config.siyuan.token, `assets/${f}`, imgData, f);
          if (ok) {
            markdownOut = markdownOut.replace(new RegExp(`images/${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), `assets/${f}`);
            imagesCopied++;
          }
        } catch (_) {}
      }
    }

    console.log(JSON.stringify(createSuccessResult({
      markdown: siyuanAssets ? markdownOut : markdown,
      pdfPath,
      outputDir,
      contentPages,
      imagesCopied,
      fileSizeMB: Math.round(fileSizeMB * 100) / 100,
      hasPageMapping: contentPages.length > 0
    })));
  } catch (e) {
    if (e.message && e.message.includes('auth')) {
      console.log(JSON.stringify(createErrorResult('认证失败',
        `MinerU extract 需要 token。请先认证: mineru-open-api auth\n注册 token: https://mineru.net/apiManage/token`)));
    } else {
      console.log(JSON.stringify(createErrorResult('转换失败', e.message)));
    }
    process.exit(1);
  }
}

main();
