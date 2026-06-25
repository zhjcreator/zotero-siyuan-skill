const { spawn } = require('child_process');
const path = require('path');

class SiyuanBridge {
  constructor(skillDir) {
    this.skillDir = skillDir;
  }

  _run(scriptName, args = []) {
    const scriptPath = path.join(this.skillDir, 'scripts', scriptName);
    return new Promise((resolve, reject) => {
      const proc = spawn('node', [scriptPath, ...args], { timeout: 30000 });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => stdout += d);
      proc.stderr.on('data', (d) => stderr += d);
      proc.on('close', (code) => {
        try { resolve(JSON.parse(stdout)); }
        catch (_) { reject(new Error(`spawn failed (${code}): ${stderr || stdout}`)); }
      });
      proc.on('error', reject);
    });
  }

  async createDoc(title, parentId, content) {
    const escaped = content.replace(/\\n/g, '\\\\n').replace(/\n/g, '\\n');
    return this._run('create.js', [title, '--parent-id', parentId, '--content', escaped]);
  }

  async createDocByPath(title, docPath, content) {
    const escaped = content.replace(/\\n/g, '\\\\n').replace(/\n/g, '\\n');
    return this._run('create.js', [title, '--path', docPath, '--content', escaped]);
  }

  async setBlockAttrs(docId, attrs) {
    const attrArgs = [];
    for (const [k, v] of Object.entries(attrs)) {
      attrArgs.push('--set', `${k}=${v}`);
    }
    return this._run('block-attrs.js', [docId, ...attrArgs]);
  }

  async getContent(docId) {
    return this._run('content.js', [docId]);
  }

  async insertBlock(content, parentId) {
    const escaped = content.replace(/\\n/g, '\\\\n').replace(/\n/g, '\\n');
    return this._run('block-insert.js', [escaped, '--parent-id', parentId]);
  }

  async updateBlock(blockId, content) {
    const escaped = content.replace(/\\n/g, '\\\\n').replace(/\n/g, '\\n');
    return this._run('block-update.js', [blockId, '--content', escaped]);
  }

  async searchContent(query, mode = 'keyword') {
    return this._run('search.js', [query, '--mode', mode]);
  }

  async getInfo(docId) {
    return this._run('info.js', [docId]);
  }

  async checkExists(title) {
    return this._run('exists.js', ['--title', title]);
  }
}

module.exports = SiyuanBridge;
