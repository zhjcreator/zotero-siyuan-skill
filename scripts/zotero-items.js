#!/usr/bin/env node
const ZoteroClient = require('./lib/zotero-client');
const ConfigManager = require('./lib/config');
const { createErrorResult, createSuccessResult } = require('./lib/result-helper');

async function main() {
  const args = process.argv.slice(2);
  const config = new ConfigManager().get();
  const client = new ZoteroClient(config.zotero.baseUrl);

  let q = '', limit = 20, start = 0, qmode = 'titleCreatorYear';
  let filterPaper = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--q' && args[i + 1]) q = args[++i];
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[++i], 10);
    if (args[i] === '--start' && args[i + 1]) start = parseInt(args[++i], 10);
    if (args[i] === '--qmode' && args[i + 1]) qmode = args[++i];
    if (args[i] === '--all') filterPaper = false;
  }

  // Zotero top-level items. Use qmode=everything for full-text match when searching
  const params = {};
  if (q) { params.q = q; params.qmode = qmode; }
  params.limit = limit;
  params.start = start;

  try {
    // Zotero Local API: /users/0/items/top returns top-level items
    const items = await client.getItems(params);
    let list = Array.isArray(items) ? items.map(i => {
      const d = i.data || i;
      return {
        key: d.key,
        title: d.title || '',
        itemType: d.itemType || '',
        year: d.date ? new Date(d.date).getFullYear() : '',
        creators: (d.creators || []).map(c => `${c.lastName || c.name}`).join(', ')
      };
    }) : [];

    if (filterPaper) {
      const excludeTypes = ['note', 'attachment', 'annotation'];
      list = list.filter(i => !excludeTypes.includes(i.itemType));
    }

    console.log(JSON.stringify(createSuccessResult(list, `找到 ${list.length} 个条目`)));
  } catch (e) {
    console.log(JSON.stringify(createErrorResult('获取失败', e.message)));
    process.exit(1);
  }
}

main();
