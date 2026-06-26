#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

/**
 * lit-note-init.js — 初始化文献笔记存储配置
 *
 * 用法:
 *   node lit-note-init.js --notebook "文献库"
 *   node lit-note-init.js --notebook "文献库" --path "/References"
 *   node lit-note-init.js --list  # 列出可用笔记本
 */

const configPath = path.join(__dirname, '..', 'config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch (_) { return {}; }
}

function writeConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

async function listNotebooks() {
  const ConfigManager = require('./lib/config');
  const config = new ConfigManager().get();
  const skillDir = config.siyuan.skillDir;
  if (!skillDir) { console.error('siyuan-skill 未找到，无法列出笔记本'); process.exit(1); }

  const { spawnSync } = require('child_process');
  const env = { ...process.env, SIYUAN_BASE_URL: config.siyuan.baseUrl, SIYUAN_TOKEN: config.siyuan.token || '' };
  const r = spawnSync('node', [path.join(skillDir, 'scripts', 'notebooks.js')], { encoding: 'utf8', timeout: 10000, env });
  try {
    const p = JSON.parse(r.stdout.trim());
    const notebooks = p.notebooks || (p.data?.notebooks) || [];
    console.log('可用笔记本:');
    notebooks.forEach(n => console.log(`  - ${n.name} (${n.id})`));
    return notebooks;
  } catch (_) { console.error('无法获取笔记本列表'); process.exit(1); }
}

function main() {
  const args = process.argv.slice(2);
  let notebookName = '', litNotePath = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--notebook' && args[i + 1]) notebookName = args[++i];
    if (args[i] === '--path' && args[i + 1]) litNotePath = args[++i];
    if (args[i] === '--list') { listNotebooks(); return; }
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
用法: node lit-note-init.js [options]

选项:
  --notebook <名称>  设置目标笔记本名称（必填）
  --path <路径>      设置文献笔记存放路径（默认 /References）
  --list             列出所有可用笔记本

示例:
  node lit-note-init.js --notebook "文献库"
  node lit-note-init.js --notebook "文献库" --path "/论文笔记"
`);
    return;
  }

  if (!notebookName) {
    console.error('错误：请用 --notebook 指定笔记本名称，或用 --list 查看可用笔记本');
    console.error('示例：node lit-note-init.js --notebook "文献库"');
    process.exit(1);
  }

  const config = readConfig();
  config.litNote = config.litNote || {};
  config.litNote.notebookName = notebookName;
  if (litNotePath) config.litNote.path = litNotePath;
  else config.litNote.path = config.litNote.path || '/References';

  writeConfig(config);
  console.log(`✓ 文献笔记存储配置已更新:`);
  console.log(`  笔记本: ${config.litNote.notebookName}`);
  console.log(`  路径:   ${config.litNote.path}`);
  console.log(`\n运行 'node lit-note-init.js --list' 查看所有可用笔记本`);
}

main();
