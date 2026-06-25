const http = require('http');

class ZoteroClient {
  constructor(baseUrl = 'http://localhost:23119') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  _request(method, path, body = null) {
    const url = new URL(path, this.baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', 'Zotero-API-Version': '3' },
      timeout: 30000
    };

    return new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              const retryAfter = res.headers['retry-after'];
              reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}` + (retryAfter ? ` (Retry-After: ${retryAfter}s)` : '')));
            }
          } catch (e) {
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
            else reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async checkStatus() {
    try {
      await this._request('GET', '/api/users/0/items?limit=1');
      return { running: true, baseUrl: this.baseUrl };
    } catch (e) {
      return { running: false, error: e.message };
    }
  }

  async getItem(itemKey) {
    return this._request('GET', `/api/users/0/items/${itemKey}`);
  }

  async getChildren(itemKey) {
    return this._request('GET', `/api/users/0/items/${itemKey}/children`);
  }

  async getItems(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this._request('GET', `/api/users/0/items/top?${qs}`);
  }

  async getAttachmentPath(itemKey) {
    return new Promise((resolve, reject) => {
      const url = new URL(`/api/users/0/items/${itemKey}/file`, this.baseUrl);
      const options = {
        method: 'GET',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: { 'Zotero-API-Version': '3' },
        timeout: 10000
      };
      const req = http.request(options, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const loc = res.headers.location || '';
          resolve(loc.startsWith('file://') ? decodeURIComponent(loc.replace('file://', '')) : loc);
          res.destroy();
          return;
        }
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(res.statusCode === 200 ? d.trim() : null));
      });
      req.on('error', reject);
      req.end();
    });
  }

  async createItems(items) {
    return this._request('POST', '/api/users/0/items', items);
  }
}

module.exports = ZoteroClient;
