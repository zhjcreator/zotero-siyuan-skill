#!/usr/bin/env node
const ZoteroClient = require('./lib/zotero-client');
const ConfigManager = require('./lib/config');
const { createErrorResult, createSuccessResult } = require('./lib/result-helper');

async function main() {
  const args = process.argv.slice(2);
  const config = new ConfigManager();
  const client = new ZoteroClient(config.get().zotero.baseUrl);

  let key = null, citekey = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--key' && args[i + 1]) key = args[++i];
    if (args[i] === '--citekey' && args[i + 1]) citekey = args[++i];
  }

  if (!key && !citekey) {
    console.log(JSON.stringify(createErrorResult('参数错误', '请提供 --key <itemKey> 或 --citekey <citekey>')));
    process.exit(1);
  }

  try {
    let itemKey = key;
    if (citekey) {
      const all = await client.getItems({ q: citekey, limit: 10 });
      const found = Array.isArray(all) ? all.find(i => {
        const d = i.data || i;
        return (d.extra || '').includes(citekey) || (d.citationKey || '') === citekey;
      }) : null;
      if (!found) {
        console.log(JSON.stringify(createErrorResult('未找到', `citekey "${citekey}" 未匹配到条目`)));
        process.exit(1);
      }
      itemKey = (found.data || found).key;
    }

    const item = await client.getItem(itemKey);
    const data = item.data;
    const children = await client.getChildren(itemKey).catch(() => []);

    let pdfKey = null, pdfPath = null;
    const notes = [];
    let annotationItems = [];

    if (Array.isArray(children)) {
      for (const child of children) {
        const cd = child.data || child;
        if (cd.itemType === 'attachment' && cd.contentType === 'application/pdf') {
          pdfKey = cd.key;
          pdfPath = cd.path || null;
          try {
            const annoChildren = await client.getChildren(pdfKey);
            if (Array.isArray(annoChildren)) {
              annotationItems = annoChildren
                .filter(a => (a.data || a).itemType === 'annotation')
                .map(a => a.data || a);
            }
          } catch (_) { /* no annotations */ }
        }
        if (cd.itemType === 'note') {
          notes.push({
            key: cd.key,
            text: cd.note || '',
            tags: (cd.tags || []).map(t => t.tag)
          });
        }
      }
    }

    const byColor = { yellow: [], red: [], blue: [], green: [], purple: [], other: [] };
    const colorMap = {
      '#ffd400': 'yellow', '#ffe900': 'yellow', '#ffff00': 'yellow',
      '#ff6666': 'red', '#ff0000': 'red', '#e60000': 'red',
      '#2ea8e5': 'blue', '#0000ff': 'blue',
      '#5fb236': 'green', '#00ff00': 'green',
      '#a28ae5': 'purple', '#800080': 'purple'
    };

    const allAnnotations = [];
    for (const anno of annotationItems) {
      let position = { pageIndex: 0 };
      try { position = typeof anno.annotationPosition === 'string' ? JSON.parse(anno.annotationPosition) : (anno.annotationPosition || { pageIndex: 0 }); } catch (_) {}
      const colorName = colorMap[anno.annotationColor] || 'other';
      const pageIndex = position.pageIndex != null ? position.pageIndex : 0;
      const zoteroOpenURI = pdfKey ? `zotero://open-pdf/library/items/${pdfKey}?page=${pageIndex}&annotation=${anno.key}` : '';
      const entry = {
        key: anno.key,
        annotationType: anno.annotationType || 'highlight',
        annotationText: anno.annotationText || '',
        annotationComment: anno.annotationComment || '',
        annotationColor: anno.annotationColor || '#ffd400',
        annotationColorName: colorName,
        annotationPageLabel: anno.annotationPageLabel || String(pageIndex + 1),
        annotationPosition: position,
        parentKey: pdfKey,
        zoteroOpenURI
      };
      if (!byColor[colorName]) byColor[colorName] = [];
      byColor[colorName].push(entry);
      allAnnotations.push(entry);
    }

    console.log(JSON.stringify(createSuccessResult({
      notes,
      annotations: { byColor, all: allAnnotations },
      pdfKey
    })));
  } catch (e) {
    console.log(JSON.stringify(createErrorResult('获取失败', e.message)));
    process.exit(1);
  }
}

main();
