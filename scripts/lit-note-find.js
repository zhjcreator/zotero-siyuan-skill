#!/usr/bin/env node
const http = require('http');
const ConfigManager = require('./lib/config');
const { createErrorResult, createSuccessResult } = require('./lib/result-helper');

async function main() {
  const args = process.argv.slice(2);
  const config = new ConfigManager().get();

  let key = '', title = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--key' && args[i + 1]) key = args[++i];
    if (args[i] === '--title' && args[i + 1]) title = args[++i];
  }
  if (!key && !title) {
    console.log(JSON.stringify(createErrorResult('参数错误', '请提供 --key <itemKey> 或 --title <title>')));
    process.exit(1);
  }

  const siyuanUrl = new URL(config.siyuan.baseUrl);
  const token = config.siyuan.token || '';

  function sqlQuery(stmt) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ stmt });
      const req = http.request({
        hostname: siyuanUrl.hostname, port: siyuanUrl.port,
        path: '/api/query/sql', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` }
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try {
            const r = JSON.parse(d);
            if (r.code === 0) resolve(r.data || []);
            else reject(new Error(`SQL error code=${r.code}`));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  try {
    if (key) {
      const literatureKey = `${config.zotero.libraryID}_${key}`;
      const rows = await sqlQuery(
        `SELECT b.* FROM blocks b JOIN attributes a ON a.block_id = b.id WHERE a.name = 'custom-literature-key' AND a.value = '${literatureKey}' AND b.type = 'd' LIMIT 1`
      );
      if (rows && rows.length) {
        console.log(JSON.stringify(createSuccessResult({
          id: rows[0].id, title: rows[0].name || rows[0].content?.substring(0, 100) || '',
          source: 'attribute', literatureKey
        }, '文献笔记已存在')));
        return;
      }
    }

    if (title) {
      const rows = await sqlQuery(
        `SELECT * FROM blocks WHERE type = 'd' AND (name LIKE '%${title.replace(/'/g, "''")}%' OR content LIKE '%${title.replace(/'/g, "''")}%') LIMIT 5`
      );
      if (rows && rows.length) {
        console.log(JSON.stringify(createSuccessResult({
          id: rows[0].id, title: rows[0].name || '', source: 'title'
        }, '文献笔记已存在')));
        return;
      }
    }

    console.log(JSON.stringify(createSuccessResult(null, '未找到文献笔记')));
  } catch (e) {
    console.log(JSON.stringify(createErrorResult('查找失败', e.message)));
    process.exit(1);
  }
}

main();
