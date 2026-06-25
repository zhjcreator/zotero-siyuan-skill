const { spawn } = require('child_process');
const path = require('path');

function escapeContent(text) {
  return text
    .replace(/\\n/g, '\u0000')
    .replace(/\n/g, '\u0000')
    .replace(/\\/g, '\\\\')
    .replace(/\u0000/g, '\\n');
}

class SiyuanBridge {
  constructor(skillDir) { this.skillDir = skillDir; }

  _run(scriptName, args = []) {
    return new Promise((resolve, reject) => {
      const proc = spawn('node', [path.join(this.skillDir, 'scripts', scriptName), ...args], { timeout: 30000 });
      let stdout = ''; proc.stdout.on('data', d => stdout += d);
      proc.on('close', (code) => { try { resolve(JSON.parse(stdout)); } catch (_) { reject(new Error(`exit ${code}: ${stdout}`)); } });
      proc.on('error', reject);
    });
  }

  async createDoc(title, parentId, content) { return this._run('create.js', [title, '--parent-id', parentId, '--content', escapeContent(content)]); }
  async createDocByPath(title, docPath, content) { return this._run('create.js', [title, '--path', docPath, '--content', escapeContent(content)]); }
  async setBlockAttrs(docId, attrs) { const a = []; for (const [k,v] of Object.entries(attrs)) a.push('--set', `${k}=${v}`); return this._run('block-attrs.js', [docId, ...a]); }
  async getContent(docId) { return this._run('content.js', [docId]); }
  async insertBlock(content, parentId) { return this._run('block-insert.js', [escapeContent(content), '--parent-id', parentId]); }
  async updateBlock(blockId, content) { return this._run('block-update.js', [blockId, '--content', escapeContent(content)]); }
  async searchContent(query, mode = 'keyword') { return this._run('search.js', [query, '--mode', mode]); }
  async getInfo(docId) { return this._run('info.js', [docId]); }
  async checkExists(title) { return this._run('exists.js', ['--title', title]); }
}

module.exports = SiyuanBridge;
