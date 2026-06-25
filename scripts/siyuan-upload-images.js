#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const ConfigManager = require('./lib/config');
const { createErrorResult, createSuccessResult } = require('./lib/result-helper');

function uploadImage(baseUrl, token, filePath, fileName) {
  return new Promise((resolve) => {
    const imgData = fs.readFileSync(filePath);
    const boundary = '----SiYuan' + Date.now();
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="path"\r\n\r\nassets/${fileName}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="isDir"\r\n\r\nfalse\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="modTime"\r\n\r\n${Math.floor(Date.now() / 1000)}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    );
    const body = Buffer.concat([header, imgData, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const url = new URL('/api/file/putFile', baseUrl);
    const req = http.request({
      method: 'POST', hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Authorization': `Token ${token}`, 'Content-Length': body.length }
    }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve({ code: -1 }); } }); });
    req.on('error', () => resolve({ code: -1 }));
    req.write(body); req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  const config = new ConfigManager().get();
  let mineruDir = '', fileList = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) mineruDir = args[++i];
    if (args[i] === '--file' && args[i + 1]) fileList = args[++i];
  }
  if (!mineruDir || !fileList) {
    console.log(JSON.stringify(createErrorResult('参数错误', '请提供 --dir <mineru-output> --file <name1,name2,...>')));
    process.exit(1);
  }

  const imgDir = path.join(mineruDir, 'images');
  if (!fs.existsSync(imgDir)) {
    console.log(JSON.stringify(createErrorResult('目录不存在', imgDir)));
    process.exit(1);
  }

  const names = fileList.split(',').map(s => s.trim()).filter(Boolean);
  const results = [];

  for (const name of names) {
    const fullPath = path.join(imgDir, name);
    if (!fs.existsSync(fullPath)) { results.push({ name, success: false, reason: '文件不存在' }); continue; }
    try {
      const res = await uploadImage(config.siyuan.baseUrl, config.siyuan.token, fullPath, name);
      results.push({ name, success: res.code === 0 });
    } catch (e) {
      results.push({ name, success: false, reason: e.message });
    }
  }

  const ok = results.filter(r => r.success).length;
  console.log(JSON.stringify(createSuccessResult({ uploaded: results, total: results.length, success: ok }, `上传: ${ok}/${results.length}`)));
}

main().catch(e => { console.log(JSON.stringify(createErrorResult('上传失败', e.message))); process.exit(1); });
