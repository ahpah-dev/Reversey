'use strict';
// Tiny JSON settings store with atomic writes and debounced persistence.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  consentVersion: 0,
  theme: 'dark', // dark | light | system
  accent: 'violet', // violet | cyan | emerald | amber | rose
  density: 'comfortable', // comfortable | compact
  env: {}, // provider env vars injected into every rea process
  extraEnv: [], // [{key, value}] user-defined additions
  recentTargets: [], // [{path, name, at}]
  favorites: [], // command names
  bounds: null,
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = { ...DEFAULTS };
    this._timer = null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...DEFAULTS, ...raw, env: { ...DEFAULTS.env, ...(raw.env || {}) } };
    } catch {
      /* first run or corrupt file: fall back to defaults */
    }
  }

  get(key) {
    return key === undefined ? this.data : this.data[key];
  }

  set(patch) {
    this.data = { ...this.data, ...patch };
    this._schedule();
    return this.data;
  }

  _schedule() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 150);
  }

  flush() {
    clearTimeout(this._timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('settings write failed', err);
    }
  }
}

module.exports = { Store, DEFAULTS };
