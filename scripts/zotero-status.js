#!/usr/bin/env node
const ZoteroClient = require('./lib/zotero-client');
const ConfigManager = require('./lib/config');

async function main() {
  const config = new ConfigManager();
  const client = new ZoteroClient(config.get().zotero.baseUrl);
  const status = await client.checkStatus();
  if (status.running) {
    const version = await client._request('GET', '/api/users/0/items?limit=1')
      .then(() => 'ok').catch(() => 'unknown');
    console.log(JSON.stringify({ success: true, data: { running: true, baseUrl: client.baseUrl, apiStatus: version } }));
  } else {
    console.log(JSON.stringify({ success: false, error: 'Zotero 未运行', message: '请确保 Zotero 已启动且 Settings → Advanced → Allow local API 已启用' }));
  }
}

main();
