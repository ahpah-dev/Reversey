'use strict';
// Runs the bundled rea-agents CLI (under Electron's own Node runtime) and
// records every run on disk so results survive restarts.
const { app } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const catalog = require('./catalog.json');
const byName = new Map(catalog.commands.map((c) => [c.name, c]));

const MAX_INLINE_BYTES = 12 * 1024 * 1024; // larger results are streamed from disk
const STDERR_KEEP = 256 * 1024;

function reaEntry() {
  let p = path.join(app.getAppPath(), 'node_modules', 'rea-agents', 'scripts', 'rea.mjs');
  if (app.isPackaged) p = p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  return p;
}

function buildArgv(req) {
  const cmd = byName.get(req.command);
  if (!cmd) throw new Error(`Unknown command: ${req.command}`);
  const argv = [cmd.name];
  for (const a of cmd.args) {
    const v = req.args?.[a.key];
    if (v === undefined || v === null || v === '') {
      if (a.required) throw new Error(`Missing required argument: ${a.key}`);
      // positional gaps are not representable; stop at the first missing optional one
      break;
    }
    argv.push(String(v));
  }
  for (const o of cmd.options) {
    const v = req.options?.[o.key];
    if (v === undefined || v === null || v === '') {
      if (o.required) throw new Error(`Missing required option: ${o.key}`);
      continue;
    }
    const flag = `--${o.flag}`;
    if (o.type === 'boolean') {
      if (v === true) argv.push(flag);
      else if (v === false && o.default === true) argv.push(`--no-${o.flag}`);
    } else if (o.type === 'array') {
      const items = Array.isArray(v) ? v : String(v).split(/\r?\n/);
      for (const item of items.map((s) => String(s).trim()).filter(Boolean)) argv.push(flag, item);
    } else {
      argv.push(flag, String(v));
    }
  }
  const g = req.global || {};
  if (g.filterOutput) argv.push('--filter-output', String(g.filterOutput));
  if (g.tokenLimit) argv.push('--token-limit', String(g.tokenLimit));
  argv.push('--format', 'json');
  return argv;
}

const quote = (s) => (/[\s"'&|<>^]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
const cliString = (argv) => ['rea', ...argv].map(quote).join(' ');

class RunManager {
  constructor({ store, send }) {
    this.store = store;
    this.send = send; // (channel, payload) => void
    this.dir = path.join(app.getPath('userData'), 'runs');
    fs.mkdirSync(this.dir, { recursive: true });
    this.active = new Map(); // id -> { child, meta, outStream, ... }
    this._progressTimer = null;
  }

  env() {
    const s = this.store.get();
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1', FORCE_COLOR: '0' };
    for (const [k, v] of Object.entries(s.env || {})) if (v) env[k] = v;
    for (const { key, value } of s.extraEnv || []) if (key) env[key] = value;
    return env;
  }

  runDir(id) {
    return path.join(this.dir, id);
  }

  // Start a tracked run (shows up in history).
  start(req) {
    const id = `${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
    const dir = this.runDir(id);
    fs.mkdirSync(dir, { recursive: true });

    // Summary delivery needs somewhere to keep the complete Evidence; give it a private home.
    req = { ...req, options: { ...(req.options || {}) }, artifacts: [...(req.artifacts || [])] };
    if (req.command === 'analyze-javascript-application' && req.options.detail === 'summary' && !req.options.evidence_output) {
      req.options.evidence_output = path.join(dir, 'evidence.json');
      req.artifacts.push({ kind: 'evidence', path: req.options.evidence_output });
    }
    const argv = buildArgv(req);

    // Commands that can save a bundle get an automatic, never-existing destination.
    const cmd = byName.get(req.command);
    const outPath = path.join(dir, 'stdout.txt');
    const errPath = path.join(dir, 'stderr.txt');

    const meta = {
      id,
      command: req.command,
      title: req.title || cmd.description,
      args: req.args || {},
      options: req.options || {},
      global: req.global || {},
      targetPath: req.targetPath || null,
      cli: cliString(argv),
      argv,
      risk: cmd.risk,
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      exitCode: null,
      outBytes: 0,
      errBytes: 0,
      artifacts: req.artifacts || [],
    };

    const outStream = fs.createWriteStream(outPath);
    const errStream = fs.createWriteStream(errPath);
    const child = spawn(process.execPath, [reaEntry(), ...argv], {
      env: this.env(),
      cwd: dir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const state = { child, meta, outStream, errStream, cancelled: false, errTail: '' };
    this.active.set(id, state);

    child.stdout.on('data', (d) => {
      meta.outBytes += d.length;
      outStream.write(d);
      this._queueProgress();
    });
    child.stderr.on('data', (d) => {
      meta.errBytes += d.length;
      errStream.write(d);
      state.errTail = (state.errTail + d.toString('utf8')).slice(-STDERR_KEEP);
      // REA reports progress as JSON lines on stderr; surface the latest one live.
      state.lineBuf = (state.lineBuf || '') + d.toString('utf8');
      const lines = state.lineBuf.split('\n');
      state.lineBuf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('{"rea_progress"')) continue;
        try {
          const p = JSON.parse(line).rea_progress;
          if (p) meta.progress = { phase: p.phase, completed: p.completed, total: p.total, message: p.message };
        } catch {
          /* partial or foreign line */
        }
      }
      this._queueProgress();
    });
    child.on('error', (err) => {
      state.errTail += `\nFailed to start process: ${err.message}`;
      errStream.write(`Failed to start process: ${err.message}\n`);
    });
    child.on('close', (code, signal) => {
      outStream.end();
      errStream.end();
      meta.endedAt = Date.now();
      meta.exitCode = code;
      meta.status = state.cancelled ? 'cancelled' : code === 0 ? 'ok' : 'error';
      if (signal && !state.cancelled) meta.status = 'error';
      this.active.delete(id);
      try {
        fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
      } catch (e) {
        console.error('meta write failed', e);
      }
      this.send('run:update', { ...meta, final: true });
    });

    this.send('run:update', { ...meta });
    return { id, meta };
  }

  _queueProgress() {
    if (this._progressTimer) return;
    this._progressTimer = setTimeout(() => {
      this._progressTimer = null;
      for (const { meta } of this.active.values()) this.send('run:update', { ...meta });
    }, 200);
  }

  cancel(id) {
    const st = this.active.get(id);
    if (!st) return false;
    st.cancelled = true;
    killTree(st.child.pid);
    return true;
  }

  cancelAll() {
    for (const id of [...this.active.keys()]) this.cancel(id);
  }

  list() {
    const out = [];
    for (const name of fs.readdirSync(this.dir)) {
      const p = path.join(this.dir, name, 'meta.json');
      try {
        out.push(JSON.parse(fs.readFileSync(p, 'utf8')));
      } catch {
        /* skip incomplete runs */
      }
    }
    for (const { meta } of this.active.values()) out.push({ ...meta });
    return out.sort((a, b) => b.startedAt - a.startedAt);
  }

  getMeta(id) {
    const live = this.active.get(id);
    if (live) return { ...live.meta };
    return JSON.parse(fs.readFileSync(path.join(this.runDir(id), 'meta.json'), 'utf8'));
  }

  // Returns the output for display. Big outputs are truncated and flagged.
  read(id) {
    const dir = this.runDir(id);
    const meta = this.getMeta(id);
    const outPath = path.join(dir, 'stdout.txt');
    const errPath = path.join(dir, 'stderr.txt');
    let stdout = '';
    let truncated = false;
    let size = 0;
    try {
      size = fs.statSync(outPath).size;
      if (size <= MAX_INLINE_BYTES) stdout = fs.readFileSync(outPath, 'utf8');
      else {
        const fd = fs.openSync(outPath, 'r');
        const buf = Buffer.alloc(256 * 1024);
        fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        stdout = buf.toString('utf8');
        truncated = true;
      }
    } catch {
      /* no output yet */
    }
    let stderr = '';
    try {
      const sz = fs.statSync(errPath).size;
      const fd = fs.openSync(errPath, 'r');
      const len = Math.min(sz, STDERR_KEEP);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, Math.max(0, sz - len));
      fs.closeSync(fd);
      stderr = buf.toString('utf8');
    } catch {
      /* none */
    }
    return { meta, stdout, stderr, truncated, size, outPath, dir };
  }

  delete(id) {
    if (this.active.has(id)) this.cancel(id);
    fs.rmSync(this.runDir(id), { recursive: true, force: true });
  }

  clear() {
    for (const name of fs.readdirSync(this.dir)) {
      if (!this.active.has(name)) fs.rmSync(path.join(this.dir, name), { recursive: true, force: true });
    }
  }

  // Untracked one-shot run, used for health checks. Resolves with parsed JSON when possible.
  quick(argv, { timeout = 120000 } = {}) {
    return new Promise((resolve) => {
      execFile(
        process.execPath,
        [reaEntry(), ...argv],
        { env: this.env(), timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout, stderr) => {
          let json = null;
          try {
            json = JSON.parse(stdout);
          } catch {
            /* plain text */
          }
          resolve({ ok: !err, code: err?.code ?? 0, stdout, stderr, json });
        },
      );
    });
  }
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}

module.exports = { RunManager, catalog, byName, reaEntry };
