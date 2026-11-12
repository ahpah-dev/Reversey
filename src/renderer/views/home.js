import { h, icon } from '../lib/dom.js';
import { state, updateSettings } from '../lib/state.js';
import { btn, badge, relTime, iconBtn } from '../lib/ui.js';
import { openTarget, openTargetDialog } from '../lib/nav.js';

const QUICK = [
  { ico: 'braces', title: 'Electron / JavaScript app', text: 'Folder or .asar → modules, routes, IPC', kind: 'any', filters: undefined },
  { ico: 'cpu', title: 'Executable or library', text: 'PE, ELF or Mach-O → imports, signatures, layout', kind: 'file' },
  { ico: 'smartphone', title: 'Android APK', text: 'Manifest, classes, signers, Flutter', kind: 'file', filters: [{ name: 'Android', extensions: ['apk', 'xapk', 'aab'] }] },
  { ico: 'globe', title: 'Network capture', text: 'HAR / SAZ → requests and payloads', kind: 'file', filters: [{ name: 'Captures', extensions: ['har', 'saz', 'pcap', 'pcapng'] }] },
];

export async function homeView() {
  const s = state.settings;
  const dz = h(
    'div',
    { class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': 'Choose a file or folder to analyze' },
    h('div', { class: 'dz-ring' }, icon('upload', 30)),
    h('h2', null, 'Drop anything to understand it'),
    h('p', null, 'Binaries, apps, archives, captures, databases — Reversey recognizes what it is and proposes the right analyses.'),
    h(
      'div',
      { class: 'dz-actions' },
      btn('Choose file…', { variant: 'primary', ico: 'file', onClick: (e) => { e.stopPropagation(); openTargetDialog('file'); } }),
      btn('Choose folder…', { ico: 'folder', onClick: (e) => { e.stopPropagation(); openTargetDialog('dir'); } }),
    ),
    h('div', { class: 'dz-hint' }, 'or press ', h('kbd', null, 'Ctrl'), h('kbd', null, 'O')),
  );
  dz.addEventListener('click', () => openTargetDialog('any'));
  dz.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openTargetDialog('any')));
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.add('over')));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('over')));

  const quick = h(
    'div',
    { class: 'quick-grid' },
    QUICK.map((q) =>
      h(
        'button',
        {
          class: 'quick-card',
          type: 'button',
          onClick: async () => {
            const [p] = await window.reversey.dialog.open({ kind: q.kind, filters: q.filters, title: q.title });
            if (p) openTarget(p);
          },
        },
        h('span', { class: 'quick-ico' }, icon(q.ico, 20)),
        h('span', { class: 'quick-text' }, h('strong', null, q.title), h('small', null, q.text)),
        icon('chevron', 16, 'quick-go'),
      ),
    ),
  );

  const recents = s.recentTargets || [];
  const recentList = h(
    'div',
    { class: 'recent-list' },
    recents.length
      ? recents.map((r) => {
          const row = h(
            'div',
            { class: 'recent-row', tabindex: '0', role: 'link' },
            h('span', { class: 'recent-ico' }, icon(r.isDir ? 'folder' : 'file', 16)),
            h('span', { class: 'recent-main' }, h('strong', null, r.name), h('small', { class: 'mono ellipsis', title: r.path }, r.path)),
            badge(r.label || 'Target'),
            h('span', { class: 'muted small' }, relTime(r.at)),
            iconBtn('x', 'Remove from recents', async (e) => {
              e.stopPropagation();
              const next = await window.reversey.target.forget(r.path);
              await updateSettings({ recentTargets: next });
              row.remove();
            }),
          );
          row.addEventListener('click', () => openTarget(r.path));
          row.addEventListener('keydown', (e) => e.key === 'Enter' && openTarget(r.path));
          return row;
        })
      : h('div', { class: 'recent-empty' }, 'Nothing analyzed yet — your recent targets will appear here.'),
  );

  const el = h(
    'div',
    { class: 'page page-narrow' },
    h('div', { class: 'page-head' }, h('h1', null, 'Analyze'), h('p', { class: 'lede' }, 'Reverse engineer anything — apps, binaries, packages and traffic — with evidence behind every answer.')),
    dz,
    h('div', { class: 'block' }, h('h3', { class: 'eyebrow' }, 'Start with'), quick),
    h('div', { class: 'block' }, h('h3', { class: 'eyebrow' }, 'Recent targets'), recentList),
    h(
      'div',
      { class: 'footer-note' },
      icon('lock', 14),
      h('span', null, 'Everything runs locally. Results include the evidence and limitations behind each conclusion.'),
    ),
  );
  return { el };
}
