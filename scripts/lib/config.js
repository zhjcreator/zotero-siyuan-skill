const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

class ConfigManager {
  constructor(options = {}) {
    this.configPath = options.configPath || path.join(__dirname, '../../config.json');
    this.config = this.load();
    this._autoDetect();
  }

  load() {
    const defaults = {
      zotero: { baseUrl: 'http://localhost:23119', apiKey: '', libraryID: 1 },
      siyuan: { baseUrl: 'http://localhost:6806', token: '', defaultNotebook: '', skillDir: '' },
      litNote: { path: '/References', template: 'zh', notebookName: '', autoAppendUserData: true },
      mineru: { enabled: true, command: 'mineru-open-api' },
      cache: { dir: '.cache/zotero-siyuan', refreshOnAnnotationChange: true }
    };
    const env = this._fromEnv();
    const file = this._fromFile();
    return { ...defaults, ...file, ...env };
  }

  /** 自动发现未设置的配置项 */
  _autoDetect() {
    if (!this.config.siyuan.skillDir) {
      this.config.siyuan.skillDir = this._findSiyuanSkillDir();
    }
    if (!this.config.siyuan.defaultNotebook && this.config.siyuan.skillDir) {
      this.config.siyuan.defaultNotebook = this._detectNotebook();
    }
  }

  _findSiyuanSkillDir() {
    const candidates = [
      path.resolve(__dirname, '../../../siyuan-skill'),
      path.resolve(process.env.HOME || '~', '.config/opencode/skills/siyuan-skill'),
      path.resolve(process.env.HOME || '~', 'WorkSpace/Skills/siyuan-skill'),
    ];
    for (const dir of candidates) {
      try { if (fs.existsSync(path.join(dir, 'scripts', 'notebooks.js'))) return dir; } catch (_) {}
    }
    return '';
  }

  _detectNotebook() {
    try {
      const script = path.join(this.config.siyuan.skillDir, 'scripts', 'notebooks.js');
      const env = { ...process.env, SIYUAN_BASE_URL: this.config.siyuan.baseUrl, SIYUAN_TOKEN: this.config.siyuan.token || '' };
      const r = spawnSync('node', [script], { encoding: 'utf8', timeout: 10000, env });
      const p = JSON.parse(r.stdout.trim());
      const notebooks = p.notebooks || (p.data && p.data.notebooks);
      if (p.success && Array.isArray(notebooks) && notebooks.length) return notebooks[0].id;
    } catch (_) {}
    return '';
  }

  _fromEnv() {
    const c = {};
    if (process.env.ZOTERO_BASE_URL) { c.zotero = c.zotero || {}; c.zotero.baseUrl = process.env.ZOTERO_BASE_URL; }
    if (process.env.ZOTERO_LIBRARY_ID) { c.zotero = c.zotero || {}; c.zotero.libraryID = parseInt(process.env.ZOTERO_LIBRARY_ID, 10); }
    if (process.env.SIYUAN_BASE_URL) { c.siyuan = c.siyuan || {}; c.siyuan.baseUrl = process.env.SIYUAN_BASE_URL; }
    if (process.env.SIYUAN_TOKEN !== undefined) { c.siyuan = c.siyuan || {}; c.siyuan.token = process.env.SIYUAN_TOKEN; }
    if (process.env.SIYUAN_DEFAULT_NOTEBOOK) { c.siyuan = c.siyuan || {}; c.siyuan.defaultNotebook = process.env.SIYUAN_DEFAULT_NOTEBOOK; }
    if (process.env.SIYUAN_SKILL_DIR) { c.siyuan = c.siyuan || {}; c.siyuan.skillDir = process.env.SIYUAN_SKILL_DIR; }
    if (process.env.LIT_NOTE_PATH) { c.litNote = c.litNote || {}; c.litNote.path = process.env.LIT_NOTE_PATH; }
    if (process.env.LIT_NOTE_NOTEBOOK) { c.litNote = c.litNote || {}; c.litNote.notebookName = process.env.LIT_NOTE_NOTEBOOK; }
    if (process.env.LIT_NOTE_TEMPLATE) { c.litNote = c.litNote || {}; c.litNote.template = process.env.LIT_NOTE_TEMPLATE; }
    if (process.env.MINERU_ENABLED !== undefined) { c.mineru = c.mineru || {}; c.mineru.enabled = process.env.MINERU_ENABLED !== 'false'; }
    if (process.env.ZOTERO_SIYUAN_CACHE_DIR) { c.cache = c.cache || {}; c.cache.dir = process.env.ZOTERO_SIYUAN_CACHE_DIR; }
    return c;
  }

  _fromFile() {
    try {
      if (fs.existsSync(this.configPath)) return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch (_) {}
    return {};
  }

  get() { return { ...this.config }; }
}

module.exports = ConfigManager;
