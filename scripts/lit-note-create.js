#!/usr/bin/env node
const { spawn } = require('child_process');
const http = require('http');
const ConfigManager = require('./lib/config');
const { createErrorResult, createSuccessResult } = require('./lib/result-helper');

async function main() {
  const args = process.argv.slice(2);
  const config = new ConfigManager().get();
  const skillDir = config.siyuan.skillDir;

  if (!skillDir) {
    console.log(JSON.stringify(createErrorResult('配置错误', 'siyuan-skill 未找到')));
    process.exit(1);
  }

  let key = '', libId = config.zotero.libraryID, title = '', content = '', entryData = '',
      force = false, pdfKey = '', notebookName = config.litNote.notebookName;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--key' && args[i + 1]) key = args[++i];
    if (args[i] === '--library-id' && args[i + 1]) libId = parseInt(args[++i], 10);
    if (args[i] === '--title' && args[i + 1]) title = args[++i];
    if (args[i] === '--content' && args[i + 1]) content = args[++i];
    if (args[i] === '--entry-data' && args[i + 1]) entryData = args[++i];
    if (args[i] === '--pdf-key' && args[i + 1]) pdfKey = args[++i];
    if (args[i] === '--notebook' && args[i + 1]) notebookName = args[++i];
    if (args[i] === '--force') force = true;
  }

  if (!key || !title) {
    console.log(JSON.stringify(createErrorResult('参数错误', '请提供 --key <itemKey> 和 --title <title>')));
    process.exit(1);
  }

  const literatureKey = `${libId}_${key}`;
  const siyuanUrl = new URL(config.siyuan.baseUrl);
  const token = config.siyuan.token || '';

  /** 通过 HTTP 直接调用思源 API，避免 siyuan-skill block-attrs.js 的 JSON 截断问题 */
  function siyuanAPI(method, path, body) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        method, hostname: siyuanUrl.hostname, port: siyuanUrl.port, path,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` }
      }, (res) => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => {
          try { resolve(JSON.parse(d)); } catch (_) { resolve({ code: -1, msg: d }); }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  // 检查是否已存在
  const findProc = spawn('node', [__dirname + '/lit-note-find.js', '--key', key], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, SIYUAN_BASE_URL: config.siyuan.baseUrl, SIYUAN_TOKEN: token }
  });
  const findOut = await new Promise((resolve) => {
    let d = ''; findProc.stdout.on('data', c => d += c);
    findProc.on('close', () => resolve(d));
    findProc.on('error', () => resolve(''));
  });
  let existingDocId = null;
  try {
    const findRes = JSON.parse(findOut.trim());
    if (findRes.success && findRes.data && findRes.data.id) existingDocId = findRes.data.id;
  } catch (_) {}

  // --force 模式: 更新已有文档的内容和属性
  if (force && existingDocId) {
    const userDataBlock = '\n\n## User Data {: custom-literature-block-type="user data"}\n\n> 以下为你的个人笔记，不会被自动刷新覆盖。';

    const escaped = (content + userDataBlock).replace(/\\n/g, '\\\\n').replace(/\n/g, '\\n');
    const updateProc = spawn('node', [skillDir + '/scripts/update.js', existingDocId, '--content', escaped], {
      timeout: 30000,
      env: { ...process.env, SIYUAN_BASE_URL: config.siyuan.baseUrl, SIYUAN_TOKEN: token }
    });
    const updateOut = await new Promise((resolve) => {
      let d = ''; updateProc.stdout.on('data', c => d += c);
      updateProc.on('close', () => resolve(d));
      updateProc.on('error', () => resolve(''));
    });

    // 直接用 HTTP API 设置属性（避免 JSON 截断）
    const attrs = {
      'custom-literature-key': literatureKey,
      'custom-entry-data': entryData || '{}',
      'custom-zotero-item-key': key,
      'custom-paper-note': 'true'
    };
    if (pdfKey) attrs['custom-zotero-pdf-key'] = pdfKey;
    await siyuanAPI('POST', '/api/attr/setBlockAttrs', { id: existingDocId, attrs });

    console.log(JSON.stringify(createSuccessResult({
      id: existingDocId, title, literatureKey, pdfKey: pdfKey || '',
      siyuanURI: `siyuan://blocks/${existingDocId}`, existed: true, updated: true
    }, '文献笔记已更新（覆盖模式）')));
    return;
  }

  // 非 force、已存在
  if (existingDocId && !force) {
    console.log(JSON.stringify(createSuccessResult({
      id: existingDocId, title, existed: true, updated: false
    }, '文献笔记已存在，返回已有 ID（使用 --force 覆盖）')));
    return;
  }

  // 新建文档
  const userDataBlock = '\n\n## User Data {: custom-literature-block-type="user data"}\n\n> 以下为你的个人笔记，不会被自动刷新覆盖。';

  const fullContent = content + userDataBlock;
  // 获取笔记本名称
  if (!notebookName) {
    try {
      const nbProc = spawn('node', [skillDir + '/scripts/notebooks.js'], {
        encoding: 'utf8', timeout: 10000,
        env: { ...process.env, SIYUAN_BASE_URL: config.siyuan.baseUrl, SIYUAN_TOKEN: token }
      });
      const nbOut = await new Promise((resolve) => {
        let d = ''; nbProc.stdout.on('data', c => d += c);
        nbProc.on('close', () => resolve(d));
        nbProc.on('error', () => resolve(''));
      });
      const nb = JSON.parse(nbOut.trim());
      const notebooks = nb.notebooks || (nb.data && nb.data.notebooks) || [];
      if (notebooks.length) notebookName = notebooks[0].name;
    } catch (_) {}
  }
  if (!notebookName) {
    console.log(JSON.stringify(createErrorResult('配置错误', '无法获取笔记本名称')));
    process.exit(1);
  }

  const litPath = config.litNote.path.replace(/^\/+/, '');
  const safeTitle = title.replace(/[/\\:*?"<>|]/g, '_');
  const docPath = `/${notebookName}/${litPath}/${safeTitle}`;
  const escaped = fullContent.replace(/\\n/g, '\\\\n').replace(/\n/g, '\\n');

  const createProc = spawn('node', [skillDir + '/scripts/create.js', safeTitle, '--path', docPath, '--content', escaped], {
    timeout: 30000,
    env: { ...process.env, SIYUAN_BASE_URL: config.siyuan.baseUrl, SIYUAN_TOKEN: token }
  });
  const createOut = await new Promise((resolve, reject) => {
    let stdout = '', stderr = '';
    createProc.stdout.on('data', c => stdout += c);
    createProc.stderr.on('data', c => stderr += c);
    createProc.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout || `exit ${code}`)));
    createProc.on('error', reject);
  });

  let createRes;
  try { createRes = JSON.parse(createOut.trim()); } catch (e) { throw new Error('解析创建结果失败: ' + createOut.substring(0, 200)); }
  if (!createRes || !createRes.success) {
    console.log(JSON.stringify(createErrorResult('创建失败', createRes?.message || createRes?.error || '未知错误')));
    process.exit(1);
  }
  const docId = createRes.data?.id || createRes.data?.docId || '';
  if (!docId) {
    console.log(JSON.stringify(createErrorResult('创建失败', '未能获取文档 ID')));
    process.exit(1);
  }

  // 直接用 HTTP API 设置属性
  const attrs = {
    'custom-literature-key': literatureKey,
    'custom-entry-data': entryData || '{}',
    'custom-zotero-item-key': key,
    'custom-paper-note': 'true'
  };
  if (pdfKey) attrs['custom-zotero-pdf-key'] = pdfKey;
  await siyuanAPI('POST', '/api/attr/setBlockAttrs', { id: docId, attrs });

  console.log(JSON.stringify(createSuccessResult({
    id: docId, title, literatureKey, path: docPath, pdfKey: pdfKey || '',
    siyuanURI: `siyuan://blocks/${docId}`, existed: false
  }, '文献笔记创建成功')));
}

main().catch(e => {
  console.log(JSON.stringify(createErrorResult('创建失败', e.message)));
  process.exit(1);
});
