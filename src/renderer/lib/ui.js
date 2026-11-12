// Shared UI primitives: toasts, modals, buttons, badges, formatting.
import { h, icon, append } from './dom.js';

export const fmtBytes = (n) => {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return `${n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)} ${u[i]}`;
};

export const fmtDuration = (ms) => {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
};

export const fmtTime = (t) => {
  const d = new Date(t);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
};

export const relTime = (t) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export const basename = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;

export function btn(label, opts = {}) {
  const { variant = 'default', ico, onClick, title, disabled, size, cls = '' } = opts;
  const b = h(
    'button',
    { class: `btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${cls}`.trim(), type: 'button', title, disabled: disabled || undefined },
    ico ? icon(ico, size === 'sm' ? 14 : 16) : null,
    label ? h('span', null, label) : null,
  );
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

export const iconBtn = (name, title, onClick, cls = '') => {
  const b = h('button', { class: `icon-btn ${cls}`.trim(), type: 'button', title, 'aria-label': title }, icon(name, 16));
  if (onClick) b.addEventListener('click', onClick);
  return b;
};

export const badge = (text, tone = 'neutral', ico) => h('span', { class: `badge badge-${tone}` }, ico ? icon(ico, 12) : null, text);

export const statusBadge = (status) => {
  const map = {
    ok: ['Completed', 'good', 'check'],
    error: ['Failed', 'bad', 'alert'],
    running: ['Running', 'info', 'activity'],
    cancelled: ['Cancelled', 'warn', 'stop'],
  };
  const [t, tone, ico] = map[status] || [status, 'neutral'];
  const b = badge(t, tone, ico);
  if (status === 'running') b.classList.add('pulse');
  return b;
};

export const riskBadge = (risk) => {
  if (risk === 'execute') return badge('Runs target', 'warn', 'bolt');
  if (risk === 'device') return badge('Changes device', 'bad', 'smartphone');
  if (risk === 'writes') return badge('Writes files', 'info', 'download');
  return null;
};

// ---- toasts ----------------------------------------------------------------
let toastHost;
export function toast(message, tone = 'info', ms = 3200) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const ico = tone === 'good' ? 'check' : tone === 'bad' ? 'alert' : 'info';
  const t = h('div', { class: `toast toast-${tone}` }, icon(ico, 16), h('span', null, message));
  toastHost.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => {
    t.classList.remove('in');
    setTimeout(() => t.remove(), 250);
  }, ms);
}

// ---- modal -----------------------------------------------------------------
export function modal({ title, body, actions = [], width = 520, onClose, dismissible = true }) {
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.classList.remove('in');
    setTimeout(() => overlay.remove(), 180);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissible) {
      e.stopPropagation();
      close();
    }
  };
  const box = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { maxWidth: `${width}px` } },
    title ? h('div', { class: 'modal-head' }, h('h2', null, title), dismissible ? iconBtn('x', 'Close', close) : null) : null,
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) => (typeof a === 'function' ? a(close) : a))) : null,
  );
  const overlay = h('div', { class: 'overlay' }, box);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay && dismissible) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('in'));
  return { close, box };
}

export function confirmDialog({ title, message, confirmLabel = 'Continue', tone = 'primary', detail }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    modal({
      title,
      width: 480,
      onClose: () => finish(false),
      body: [h('p', { class: 'modal-msg' }, message), detail ? h('div', { class: 'callout' }, detail) : null],
      actions: [
        (close) => btn('Cancel', { onClick: () => { finish(false); close(); } }),
        (close) => btn(confirmLabel, { variant: tone, onClick: () => { finish(true); close(); } }),
      ],
    });
  });
}

export const empty = (ico, title, text, action) =>
  h('div', { class: 'empty' }, h('div', { class: 'empty-ico' }, icon(ico, 28)), h('h3', null, title), text ? h('p', null, text) : null, action || null);

export const kv = (pairs) =>
  h(
    'dl',
    { class: 'kv' },
    pairs
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [h('dt', null, k), h('dd', null, v instanceof Node ? v : String(v))]),
  );

export function copyText(text, label = 'Copied to clipboard') {
  return window.reversey.clipboard.write(text).then(() => toast(label, 'good', 1800));
}

export const section = (title, content, right) =>
  h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h3', null, title), right || null), content);

export { append };

export const kbd = (t) => h('kbd', null, t);
