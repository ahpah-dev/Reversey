'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

if (process.env.REVERSEY_USER_DATA) app.setPath('userData', process.env.REVERSEY_USER_DATA);
app.setName('Reversey');
if (process.platform === 'win32') app.setAppUserModelId('app.reversey.desktop');

const { Store } = require('./store');
const { RunManager, catalog, byName, reaEntry } = require('./rea');
const { detect } = require('./targets');

const CONSENT_VERSION = 1;
const isDev = !app.isPackaged;
let win = null;
let store = null;
let runs = null;

if (!app.requestSingleInstanceLock() && !process.env.REVERSEY_USER_DATA) {
  app.quit();
}
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

const THEME = {
  dark: { bg: '#0b0d12', overlay: '#0b0d12', symbol: '#c7cbd6' },
  light: { bg: '#f6f7fb', overlay: '#f6f7fb', symbol: '#3a3f4d' },
};
const effectiveTheme = () => {
  const t = store.get('theme');
  return t === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : t;
};

function applyTheme() {
  const t = store.get('theme');
  nativeTheme.themeSource = t === 'system' ? 'system' : t;
  const th = THEME[effectiveTheme()];
  if (win && !win.isDestroyed()) {
    win.setBackgroundColor(th.bg);
    if (process.platform !== 'darwin' && win.setTitleBarOverlay) {
      try {
        win.setTitleBarOverlay({ color: th.overlay, symbolColor: th.symbol, height: 44 });
      } catch {
        /* overlay unsupported */
      }
    }
  }
}

function createWindow() {
  const bounds = store.get('bounds') || {};
  const th = THEME[effectiveTheme()];
  win = new BrowserWindow({
    width: bounds.width || 1360,
    height: bounds.height || 860,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1020,
    minHeight: 640,
    show: false,
    backgroundColor: th.bg,
    title: 'Reversey',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 14 } }
      : { titleBarOverlay: { color: th.overlay, symbolColor: th.symbol, height: 44 } }),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (bounds.maximized) win.maximize();

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    store.set({ bounds: { ...win.getNormalBounds(), maximized: win.isMaximized() } });
  };
  win.on('resized', saveBounds);
  win.on('moved', saveBounds);
  win.on('maximize', saveBounds);
  win.on('unmaximize', saveBounds);
  win.on('closed', () => (win = null));

  // Never navigate away from the app shell; links open in the default browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      openExternalSafe(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });

  if (isDev || process.env.REVERSEY_DEVTOOLS) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
        win.webContents.toggleDevTools();
      }
    });
  }
}

function openExternalSafe(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(url);
  } catch {
    /* ignore malformed urls */
  }
}

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

function registerIpc() {
  const handle = (name, fn) =>
    ipcMain.handle(name, async (_e, ...args) => {
      try {
        return { ok: true, value: await fn(...args) };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

  handle('app:info', () => ({
    version: app.getVersion(),
    reaVersion: catalog.reaVersion,
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath('userData'),
    consentVersion: CONSENT_VERSION,
    theme: effectiveTheme(),
  }));
  handle('app:catalog', () => catalog);
  handle('app:license', () => ({
    mit: fs.readFileSync(path.join(__dirname, '..', '..', 'licenses', 'REA-LICENSE.txt'), 'utf8'),
    disclaimer: fs.readFileSync(path.join(__dirname, '..', '..', 'licenses', 'REA-DISCLAIMER.md'), 'utf8'),
  }));

  handle('settings:get', () => store.get());
  handle('settings:set', (patch) => {
    const next = store.set(patch);
    if ('theme' in patch) applyTheme();
    return next;
  });

  handle('dialog:open', async (opts = {}) => {
    const props = [];
    if (opts.kind === 'dir') props.push('openDirectory');
    else if (opts.kind === 'any') props.push('openFile', 'openDirectory');
    else props.push('openFile');
    if (opts.multi) props.push('multiSelections');
    if (opts.create) props.push('createDirectory');
    const r = await dialog.showOpenDialog(win, { title: opts.title, properties: props, filters: opts.filters });
    return r.canceled ? [] : r.filePaths;
  });
  handle('dialog:save', async (opts = {}) => {
    const r = await dialog.showSaveDialog(win, { title: opts.title, defaultPath: opts.defaultPath, filters: opts.filters });
    return r.canceled ? null : r.filePath;
  });

  handle('target:detect', (p) => {
    const info = detect(p, byName);
    const recents = (store.get('recentTargets') || []).filter((r) => r.path !== p);
    recents.unshift({ path: p, name: info.name, label: info.primaryLabel, isDir: info.isDir, at: Date.now() });
    store.set({ recentTargets: recents.slice(0, 12) });
    return info;
  });
  handle('target:forget', (p) => {
    store.set({ recentTargets: (store.get('recentTargets') || []).filter((r) => r.path !== p) });
    return store.get('recentTargets');
  });
  handle('fs:exists', (p) => fs.existsSync(p));
  handle('fs:readText', (p, limit = 2 * 1024 * 1024) => {
    const st = fs.statSync(p);
    if (st.size > limit) throw new Error(`File is larger than ${(limit / 1048576).toFixed(0)} MB`);
    return fs.readFileSync(p, 'utf8');
  });

  handle('run:start', (req) => {
    const { id, meta } = runs.start(req);
    return { id, meta };
  });
  handle('run:cancel', (id) => runs.cancel(id));
  handle('run:list', () => runs.list());
  handle('run:read', (id) => runs.read(id));
  handle('run:delete', (id) => runs.delete(id));
  handle('run:clear', () => runs.clear());
  handle('run:reveal', (id) => shell.showItemInFolder(path.join(runs.runDir(id), fs.existsSync(path.join(runs.runDir(id), 'stdout.txt')) ? 'stdout.txt' : 'meta.json')));
  handle('run:export', async (id, kind = 'json') => {
    const { meta, outPath } = runs.read(id);
    const dest = await dialog.showSaveDialog(win, {
      title: 'Export result',
      defaultPath: `${meta.command}-${meta.id}.${kind === 'json' ? 'json' : 'txt'}`,
      filters: [kind === 'json' ? { name: 'JSON', extensions: ['json'] } : { name: 'Text', extensions: ['txt'] }],
    });
    if (dest.canceled) return null;
    fs.copyFileSync(outPath, dest.filePath);
    return dest.filePath;
  });

  handle('health:doctor', () => runs.quick(['doctor', '--format', 'json']));
  handle('health:providers', () => runs.quick(['providers', '--format', 'json']));

  handle('shell:reveal', (p) => shell.showItemInFolder(p));
  handle('shell:open', (p) => shell.openPath(p));
  handle('shell:external', (url) => openExternalSafe(url));
  handle('shell:openDataDir', () => shell.openPath(app.getPath('userData')));
  handle('clipboard:write', (text) => require('electron').clipboard.writeText(String(text)));
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  runs = new RunManager({ store, send });
  nativeTheme.on('updated', () => {
    if (store.get('theme') === 'system') {
      applyTheme();
      send('theme:changed', effectiveTheme());
    }
  });

  // Strict CSP for the app shell (renderer is local-only, no remote content).
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
        ],
      },
    });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }])
      : null,
  );

  registerIpc();
  applyTheme();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  runs?.cancelAll();
  store?.flush();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

module.exports = { reaEntry };
