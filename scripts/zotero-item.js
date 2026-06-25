#!/usr/bin/env node
const ZoteroClient = require('./lib/zotero-client');
const ConfigManager = require('./lib/config');
const { createErrorResult, createSuccessResult } = require('./lib/result-helper');

async function main() {
  const args = process.argv.slice(2);
  const config = new ConfigManager();
  const client = new ZoteroClient(config.get().zotero.baseUrl);
  const libId = config.get().zotero.libraryID;

  let itemKey = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--key' && args[i + 1]) itemKey = args[++i];
  }

  if (!itemKey) {
    console.log(JSON.stringify(createErrorResult('参数错误', '请提供 --key <itemKey>')));
    process.exit(1);
  }

  try {
    const item = await client.getItem(itemKey);
    const data = item.data;
    const children = await client.getChildren(itemKey).catch(() => []);

    let pdfKey = null, pdfPath = null, notes = [];
    if (Array.isArray(children)) {
      for (const child of children) {
        const cd = child.data || child;
        if (cd.itemType === 'attachment' && cd.contentType === 'application/pdf') {
          pdfKey = cd.key;
          pdfPath = cd.path || null;
        }
        if (cd.itemType === 'note') {
          notes.push({ key: cd.key, text: cd.note || '', tags: (cd.tags || []).map(t => t.tag) });
        }
      }
    }

    const creators = (data.creators || []).map(c => `${c.lastName || c.name}, ${c.firstName || ''}`.replace(/, $/, ''));
    const firstAuthor = creators.length > 0 ? (data.creators[0].lastName || data.creators[0].name) : '';
    let shortAuthor = '';
    if (creators.length === 1) shortAuthor = firstAuthor;
    else if (creators.length === 2) shortAuthor = `${firstAuthor} & ${data.creators[1].lastName || data.creators[1].name}`;
    else if (creators.length > 2) shortAuthor = `${firstAuthor} et al.`;

    const result = {
      key: data.key,
      libraryID: libId,
      title: data.title || '',
      shortTitle: data.shortTitle || '',
      authorString: creators.join(', '),
      authors: creators,
      firstAuthor,
      shortAuthor,
      year: data.date ? new Date(data.date).getFullYear() : (data.parsedDate ? new Date(data.parsedDate).getFullYear() : ''),
      journal: data.publicationTitle || data.journalAbbreviation || data.bookTitle || data.proceedingsTitle || '',
      volume: data.volume || '',
      issue: data.issue || '',
      pages: data.pages || '',
      doi: data.DOI || '',
      url: data.url || '',
      abstract: data.abstractNote || '',
      type: data.itemType || '',
      tags: (data.tags || []).map(t => t.tag),
      collections: [],
      pdfPath,
      pdfKey,
      pdfOpenURI: pdfKey ? `zotero://open-pdf/library/items/${pdfKey}` : '',
      zoteroSelectURI: `zotero://select/library/items/${data.key}`,
      notes,
      dateAdded: data.dateAdded || '',
      dateModified: data.dateModified || ''
    };

    console.log(JSON.stringify(createSuccessResult(result)));
  } catch (e) {
    console.log(JSON.stringify(createErrorResult('获取失败', e.message)));
    process.exit(1);
  }
}

main();
