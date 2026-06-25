#!/usr/bin/env node
const { spawn } = require('child_process');
const http = require('http');
const ConfigManager = require('./lib/config');
const { createErrorResult, createSuccessResult } = require('./lib/result-helper');

/**
 * 创建或更新思源文献笔记。
 * 优先兼容 siyuan-plugin-citation：AI 内容写入 User Data 区域，
 * 插件可以安全刷新上方的模板部分而不会覆盖 AI 内容。
 */

/** 标准化换行：字面量 \n → 实际换行 → siyuan-skill 格式 \\n */
function escapeNL(text) {
  return text.replace(/\\n/g, '\n').replace(/\n/g, '\\n');
}

async function main() {
  const args = process.argv.slice(2);
  const config = new ConfigManager().get();
  const skillDir = config.siyuan.skillDir;
  if (!skillDir) { console.log(JSON.stringify(createErrorResult('配置错误', 'siyuan-skill 未找到'))); process.exit(1); }

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
  if (!key || !title) { console.log(JSON.stringify(createErrorResult('参数错误', '请提供 --key <itemKey> 和 --title <title>'))); process.exit(1); }

  const literatureKey = `${libId}_${key}`;
  const siyuanUrl = new URL(config.siyuan.baseUrl);
  const token = config.siyuan.token || '';
  const spawnEnv = { ...process.env, SIYUAN_BASE_URL: config.siyuan.baseUrl, SIYUAN_TOKEN: token };

  function siyuanAPI(method, path, body) {
    return new Promise((resolve, reject) => {
      const req = http.request({ method, hostname: siyuanUrl.hostname, port: siyuanUrl.port, path,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` }
      }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve({ code: -1 }); } }); });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  function spawnOut(cmd, args, opts) {
    return new Promise((resolve) => {
      const p = spawn(cmd, args, { encoding: 'utf8', timeout: opts?.timeout || 10000, env: opts?.env || spawnEnv });
      let d = ''; p.stdout.on('data', c => d += c);
      p.on('close', () => resolve(d)); p.on('error', () => resolve(''));
    });
  }

  // 1. 查找已有笔记
  try {
    const fOut = await spawnOut('node', [__dirname + '/lit-note-find.js', '--key', key]);
    const findRes = JSON.parse(fOut.trim());
    if (findRes.success && findRes.data?.id) {
      const docId = findRes.data.id;

      // 2. 笔记已存在 → 检查是否有 User Data 区域，追加 AI 内容
      let userDataBlockId = null;
      try {
        const sqlRes = await siyuanAPI('POST', '/api/query/sql', {
          stmt: `SELECT a.block_id FROM attributes a WHERE name = 'custom-literature-block-type' AND value = 'user data' AND a.block_id IN (SELECT b.id FROM blocks b WHERE b.root_id = '${docId}')`
        });
        if (sqlRes.code === 0 && sqlRes.data?.length) userDataBlockId = sqlRes.data[0].block_id;
      } catch (_) {}

      const userDataContent = '\n\n' + content;
      if (userDataBlockId) {
        // 更新 User Data 块
        const getBlockRes = await siyuanAPI('POST', '/api/block/getBlockInfo', { id: userDataBlockId });
        const oldContent = (getBlockRes.data?.content || '').replace(/\n/g, '\\n');
        const newMarkdown = oldContent + escapeNL(userDataContent);
        await siyuanAPI('POST', '/api/block/updateBlock', { id: userDataBlockId, dataType: 'markdown', data: newMarkdown });
        console.log(JSON.stringify(createSuccessResult({ id: docId, title, existed: true, updated: true, appendedToUserData: true }, '已追加到 User Data')));
      } else {
        // 无 User Data 区域，创建新的
        const insertRes = await siyuanAPI('POST', '/api/block/insertBlock', {
          dataType: 'markdown',
          data: escapeNL('## User Data\n{: custom-literature-block-type="user data"}\n\n' + content),
          parentID: docId
        });
        console.log(JSON.stringify(createSuccessResult({ id: docId, title, existed: true, updated: true, createdUserData: true }, '已创建 User Data 并写入')));
      }
      return;
    }
  } catch (_) {}

  // 3. 笔记不存在 → 创建新文档（仅含 minimal 模板 + User Data，让插件后续补充模板）
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

  const docContent = escapeNL(content + '\n\n## User Data\n{: custom-literature-block-type="user data"}\n\n> 以下内容由 AI 生成，不会被插件刷新覆盖。');
  const createOut = await spawnOut('node', [skillDir + '/scripts/create.js', safeTitle, '--path', docPath, '--content', docContent], { timeout: 30000 });
  let createRes;
  try { createRes = JSON.parse(createOut.trim()); } catch (e) { throw new Error('解析创建结果失败'); }
  if (!createRes?.success) { console.log(JSON.stringify(createErrorResult('创建失败', createRes?.message || '未知错误'))); process.exit(1); }
  const docId = createRes.data?.id || '';
  if (!docId) { console.log(JSON.stringify(createErrorResult('创建失败', '未获取文档 ID'))); process.exit(1); }

  // 如果标题被 sanitize 了，重命名为原始标题
  if (safeTitle !== title) {
    await spawnOut('node', [skillDir + '/scripts/rename.js', docId, title]);
  }

  await siyuanAPI('POST', '/api/attr/setBlockAttrs', {
    id: docId,
    attrs: Object.assign(
      { 'custom-literature-key': literatureKey, 'custom-entry-data': entryData || '{}', 'custom-zotero-item-key': key, 'custom-paper-note': 'true' },
      pdfKey ? { 'custom-zotero-pdf-key': pdfKey } : {}
    )
  });

  console.log(JSON.stringify(createSuccessResult({ id: docId, title, literatureKey, path: docPath, pdfKey: pdfKey || '', siyuanURI: `siyuan://blocks/${docId}` }, '文献笔记创建成功')));
}

main().catch(e => { console.log(JSON.stringify(createErrorResult('创建失败', e.message))); process.exit(1); });
