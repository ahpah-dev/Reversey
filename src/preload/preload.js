'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = async (channel, ...args) => {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.value;
};

const subscribe = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

// Dropped files expose their real paths only through webUtils, which is
// unavailable to page scripts; resolve here and hand the paths over.
const dropHandlers = new Set();
window.addEventListener(
  'drop',
  (e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    const paths = files.map((f) => webUtils.getPathForFile(f)).filter(Boolean);
    if (paths.length) for (const h of dropHandlers) h(paths);
  },
  true,
);

contextBridge.exposeInMainWorld('reversey', {
  info: () => invoke('app:info'),
  catalog: () => invoke('app:catalog'),
  license: () => invoke('app:license'),
  settings: { get: () => invoke('settings:get'), set: (patch) => invoke('settings:set', patch) },
  dialog: {
    open: (opts) => invoke('dialog:open', opts),
    save: (opts) => invoke('dialog:save', opts),
  },
  target: {
    detect: (p) => invoke('target:detect', p),
    forget: (p) => invoke('target:forget', p),
  },
  fs: { exists: (p) => invoke('fs:exists', p), readText: (p, limit) => invoke('fs:readText', p, limit) },
  run: {
    start: (req) => invoke('run:start', req),
    cancel: (id) => invoke('run:cancel', id),
    list: () => invoke('run:list'),
    read: (id) => invoke('run:read', id),
    remove: (id) => invoke('run:delete', id),
    clear: () => invoke('run:clear'),
    reveal: (id) => invoke('run:reveal', id),
    export: (id, kind) => invoke('run:export', id, kind),
    onUpdate: subscribe('run:update'),
  },
  health: { doctor: () => invoke('health:doctor'), providers: () => invoke('health:providers') },
  shell: {
    reveal: (p) => invoke('shell:reveal', p),
    open: (p) => invoke('shell:open', p),
    external: (url) => invoke('shell:external', url),
    openDataDir: () => invoke('shell:openDataDir'),
  },
  clipboard: { write: (t) => invoke('clipboard:write', t) },
  onDrop: (cb) => {
    dropHandlers.add(cb);
    return () => dropHandlers.delete(cb);
  },
  onThemeChanged: subscribe('theme:changed'),
  platform: process.platform,
});
