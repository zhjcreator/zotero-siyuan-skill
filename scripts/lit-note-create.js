#!/usr/bin/env node
const { spawn } = require('child_process');
const http = require('http');
const ConfigManager = require('./lib/config');
const { createErrorResult, createSuccessResult } = require('./lib/result-helper');

/** 标准化内容：仅处理换行 → siyuan 格式 \\n。
 *  公式中的反斜杠原样保留（SiYuan kramdown 在 $...$ / $$...$$ 内不处理转义） */
function escapeContent(text) {
  return text.replace(/\\n/g, '\u0000').replace(/\n/g, '\u0000').replace(/\u0000/g, '\\n');
}

/** 从文件读取内容（绕过 bash 变量展开问题） */
function readContentFile(filePath) {
  try {
    return require('fs').readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const config = new ConfigManager().get();
  const skillDir = config.siyuan.skillDir;
  if (!skillDir) { console.log(JSON.stringify(createErrorResult('配置错误', 'siyuan-skill 未找到'))); process.exit(1); }

  let key = '', libId = config.zotero.libraryID, title = '', content = '', entryData = '',
      force = false, pdfKey = '', notebookName = config.litNote.notebookName, contentFile = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--key' && args[i + 1]) key = args[++i];
    if (args[i] === '--library-id' && args[i + 1]) libId = parseInt(args[++i], 10);
    if (args[i] === '--title' && args[i + 1]) title = args[++i];
    if (args[i] === '--content' && args[i + 1]) content = args[++i];
    if (args[i] === '--content-file' && args[i + 1]) contentFile = args[++i];
    if (args[i] === '--entry-data' && args[i + 1]) entryData = args[++i];
    if (args[i] === '--pdf-key' && args[i + 1]) pdfKey = args[++i];
    if (args[i] === '--notebook' && args[i + 1]) notebookName = args[++i];
    if (args[i] === '--force') force = true;
  }
  // --content-file 优先（绕过 bash 变量展开）
  if (contentFile) {
    const fileContent = readContentFile(contentFile);
    if (!fileContent) { console.log(JSON.stringify(createErrorResult('文件读取失败', contentFile))); process.exit(1); }
    content = fileContent;
  }
  if (!key || !title) { console.log(JSON.stringify(createErrorResult('参数错误', '需 --key 和 --title'))); process.exit(1); }
  if (!content) { console.log(JSON.stringify(createErrorResult('参数错误', '需 --content 或 --content-file'))); process.exit(1); }

  const literatureKey = `${libId}_${key}`;
  const siyuanUrl = new URL(config.siyuan.baseUrl);
  const token = config.siyuan.token || '';
  const spawnEnv = { ...process.env, SIYUAN_BASE_URL: config.siyuan.baseUrl, SIYUAN_TOKEN: token };

  function siyuanAPI(method, path, body) {
    return new Promise((resolve, reject) => {
      const req = http.request({ method, hostname: siyuanUrl.hostname, port: siyuanUrl.port, path,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` }
      }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve({ code: -1 }); } }); });
      req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
    });
  }
  function spawnOut(cmd, args, opts) {
    return new Promise((resolve) => {
      const p = spawn(cmd, args, { encoding: 'utf8', timeout: opts?.timeout || 10000, env: opts?.env || spawnEnv });
      let d = ''; p.stdout.on('data', c => d += c); p.on('close', () => resolve(d)); p.on('error', () => resolve(''));
    });
  }

  // 查找 User Data 块（按属性）
  async function findUserDataBlock(docId) {
    try {
      const sqlRes = await siyuanAPI('POST', '/api/query/sql', {
        stmt: `SELECT a.block_id FROM attributes a WHERE name='custom-literature-block-type' AND value='user data' AND a.block_id IN (SELECT id FROM blocks WHERE root_id='${docId}')`
      });
      if (sqlRes.code === 0 && sqlRes.data?.length) return sqlRes.data[0].block_id;
    } catch (_) {}
    return null;
  }

  // 在文档末尾插入 User Data 块
  async function appendUserDataBlock(docId, md) {
    const res = await siyuanAPI('POST', '/api/block/insertBlock', { dataType: 'markdown', data: md, parentID: docId });
    // 从响应中获取新块 ID 并设置属性
    const blockId = res.data?.[0]?.doOperations?.[0]?.id;
    if (blockId) {
      await siyuanAPI('POST', '/api/attr/setBlockAttrs', { id: blockId, attrs: { 'custom-literature-block-type': 'user data' } });
    }
    return { success: blockId != null };
  }

  // ── 1. 查找已有笔记 ──
  try {
    const fOut = await spawnOut('node', [__dirname + '/lit-note-find.js', '--key', key]);
    const findRes = JSON.parse(fOut.trim());
    if (findRes.success && findRes.data?.id) {
      const docId = findRes.data.id;

      // 笔记已存在 → 找到原 User Data 块，替换内容
      let ubid = await findUserDataBlock(docId);
      if (ubid) {
        const getBlockRes = await siyuanAPI('POST', '/api/block/getBlockInfo', { id: ubid });
        const oldContent = (getBlockRes.data?.content || '').replace(/\n/g, '\\n');
        await siyuanAPI('POST', '/api/block/updateBlock', { id: ubid, dataType: 'markdown', data: oldContent + escapeContent('\n\n' + content) });
        console.log(JSON.stringify(createSuccessResult({ id: docId, title, existed: true, updated: true }, '已追加到 User Data')));
      } else {
        await appendUserDataBlock(docId, escapeContent(content));
        console.log(JSON.stringify(createSuccessResult({ id: docId, title, existed: true, updated: true }, '已创建 User Data 并写入')));
      }

      // 更新文档级属性
      const attrs = { 'custom-literature-key': literatureKey, 'custom-zotero-item-key': key, 'custom-paper-note': 'true' };
      if (entryData) attrs['custom-entry-data'] = entryData;
      if (pdfKey) attrs['custom-zotero-pdf-key'] = pdfKey;
      await siyuanAPI('POST', '/api/attr/setBlockAttrs', { id: docId, attrs });
      return;
    }
  } catch (_) {}

  // ── 2. 新建文档 ──
  if (!notebookName) {
    try {
      const nbOut = await spawnOut('node', [skillDir + '/scripts/notebooks.js']);
      const nb = JSON.parse(nbOut.trim());
      const notebooks = nb.notebooks || (nb.data?.notebooks) || [];
      if (notebooks.length) notebookName = notebooks[0].name;
    } catch (_) {}
  }
  if (!notebookName) { console.log(JSON.stringify(createErrorResult('配置错误', '无法获取笔记本名称'))); process.exit(1); }

  const litPath = config.litNote.path.replace(/^\/+/, '');
  const safeTitle = title.replace(/[/\\:*?"<>|]/g, '_');
  const docPath = `/${notebookName}/${litPath}/${safeTitle}`;

  // 新建文档：只写 AI 内容，User Data 由插件管理
  const createOut = await spawnOut('node', [skillDir + '/scripts/create.js', safeTitle, '--path', docPath, '--content', escapeContent(content)], { timeout: 30000 });
  let createRes;
  try { createRes = JSON.parse(createOut.trim()); } catch (e) { throw new Error('解析创建结果失败'); }
  if (!createRes?.success) { console.log(JSON.stringify(createErrorResult('创建失败', createRes?.message || '未知错误'))); process.exit(1); }
  const docId = createRes.data?.id || '';
  if (!docId) { console.log(JSON.stringify(createErrorResult('创建失败', '未获取文档 ID'))); process.exit(1); }

  if (safeTitle !== title) { await spawnOut('node', [skillDir + '/scripts/rename.js', docId, title]); }

  // 为第一个块设置 User Data 属性（标记为插件可识别的用户数据区）
  try {
    const childrenRes = await siyuanAPI('POST', '/api/block/getChildBlocks', { id: docId });
    const firstBlock = childrenRes.data?.[0]?.id;
    if (firstBlock) {
      await siyuanAPI('POST', '/api/attr/setBlockAttrs', { id: firstBlock, attrs: { 'custom-literature-block-type': 'user data' } });
    }
  } catch (_) {}

  await siyuanAPI('POST', '/api/attr/setBlockAttrs', {
    id: docId,
    attrs: { 'custom-literature-key': literatureKey, 'custom-entry-data': entryData || '{}', 'custom-zotero-item-key': key, 'custom-paper-note': 'true', ...(pdfKey ? { 'custom-zotero-pdf-key': pdfKey } : {}) }
  });

  console.log(JSON.stringify(createSuccessResult({ id: docId, title, literatureKey, path: docPath, pdfKey: pdfKey || '', siyuanURI: `siyuan://blocks/${docId}` }, '文献笔记创建成功')));
}

main().catch(e => { console.log(JSON.stringify(createErrorResult('创建失败', e.message))); process.exit(1); });
