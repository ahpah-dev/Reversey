// App-wide state, event bus and the run-launching helper.
import { toast, confirmDialog } from './ui.js';

export const state = {
  info: null,
  catalog: null,
  byName: new Map(),
  settings: null,
  runs: new Map(),
  prefill: null, // one-shot prefill for the tool form
};

const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => {
  const h = (e) => fn(e.detail);
  bus.addEventListener(name, h);
  return () => bus.removeEventListener(name, h);
};

export async function bootstrap() {
  const api = window.reversey;
  const [info, catalog, settings, runs] = await Promise.all([api.info(), api.catalog(), api.settings.get(), api.run.list()]);
  state.info = info;
  state.catalog = catalog;
  state.byName = new Map(catalog.commands.map((c) => [c.name, c]));
  state.settings = settings;
  for (const r of runs) state.runs.set(r.id, r);
  api.run.onUpdate((meta) => {
    const prev = state.runs.get(meta.id);
    state.runs.set(meta.id, meta);
    emit('runs', meta);
    if (meta.final && prev?.status === 'running') {
      const title = state.byName.get(meta.command)?.description || meta.command;
      if (meta.status === 'ok') toast(`${meta.command} finished`, 'good');
      else if (meta.status === 'error') toast(`${meta.command} failed`, 'bad');
      void title;
    }
  });
}

export async function updateSettings(patch) {
  state.settings = await window.reversey.settings.set(patch);
  emit('settings', state.settings);
  return state.settings;
}

export const runsList = () => [...state.runs.values()].sort((a, b) => b.startedAt - a.startedAt);
export const activeRuns = () => runsList().filter((r) => r.status === 'running');

export function applyAppearance() {
  const s = state.settings;
  const root = document.documentElement;
  const theme = s.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : s.theme;
  root.dataset.theme = theme;
  root.dataset.accent = s.accent;
  root.dataset.density = s.density;
}

// Starts a run, optionally gating risky commands behind a confirmation.
export async function startRun(command, args = {}, options = {}, opts = {}) {
  const cmd = state.byName.get(command);
  if (!cmd) return toast(`Unknown command ${command}`, 'bad');
  if (!opts.skipConfirm && (cmd.risk === 'execute' || cmd.risk === 'device')) {
    const ok = await confirmDialog({
      title: cmd.risk === 'device' ? 'This changes a connected device' : 'This command runs software',
      message:
        cmd.risk === 'device'
          ? `“${command}” modifies the device it targets (installs, removes, starts or stops software, or writes files).`
          : `“${command}” launches or attaches to a process, which executes code on this computer with your user permissions.`,
      detail: 'Only continue for targets you own or are authorized to examine. Prefer a disposable VM for untrusted software.',
      confirmLabel: 'Run anyway',
      tone: 'danger',
    });
    if (!ok) return null;
  }
  try {
    const { id } = await window.reversey.run.start({
      command,
      args,
      options,
      global: opts.global,
      title: opts.title,
      targetPath: opts.targetPath || null,
    });
    if (opts.navigate !== false) location.hash = `#/run/${id}`;
    return id;
  } catch (e) {
    toast(e.message, 'bad', 6000);
    return null;
  }
}
