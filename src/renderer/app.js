import { h, icon, mount, clear } from './lib/dom.js';
import { state, bootstrap, on, activeRuns, applyAppearance, updateSettings } from './lib/state.js';
import { toast, modal, btn, kbd } from './lib/ui.js';
import { openPalette } from './views/palette.js';
import { homeView } from './views/home.js';
import { targetView } from './views/target.js';
import { toolsView } from './views/tools.js';
import { toolFormView } from './views/toolForm.js';
import { runView } from './views/run.js';
import { workspaceView } from './views/workspace.js';
import { healthView } from './views/health.js';
import { settingsView } from './views/settings.js';
import { aboutView } from './views/about.js';
import { logoMark } from './views/logo.js';
import { openTarget, openTargetDialog, getActiveDropField } from './lib/nav.js';

const NAV = [
  { id: 'home', label: 'Analyze', ico: 'scan', hash: '#/home', keys: 'Ctrl+1' },
  { id: 'tools', label: 'Tools', ico: 'wrench', hash: '#/tools', keys: 'Ctrl+2' },
  { id: 'workspace', label: 'Workspace', ico: 'history', hash: '#/workspace', keys: 'Ctrl+3' },
  { id: 'health', label: 'Health', ico: 'heart', hash: '#/health', keys: 'Ctrl+4' },
];

const ROUTES = [
  { re: /^#\/home$/, nav: 'home', view: homeView },
  { re: /^#\/target\?(.*)$/, nav: 'home', view: targetView },
  { re: /^#\/tools(?:\?(.*))?$/, nav: 'tools', view: toolsView },
  { re: /^#\/tool\/([\w-]+)$/, nav: 'tools', view: toolFormView },
  { re: /^#\/run\/([\w-]+)$/, nav: 'workspace', view: runView },
  { re: /^#\/workspace$/, nav: 'workspace', view: workspaceView },
  { re: /^#\/health$/, nav: 'health', view: healthView },
  { re: /^#\/settings$/, nav: 'settings', view: settingsView },
  { re: /^#\/about$/, nav: 'about', view: aboutView },
];

let cleanup = null;
let main;
let navEls = {};
let runBadge;
let token = 0;

function buildShell() {
  const root = document.getElementById('app');
  document.body.classList.toggle('mac', window.reversey.platform === 'darwin');

  const nav = h('nav', { class: 'nav', 'aria-label': 'Primary' });
  for (const n of NAV) {
    const a = h('a', { class: 'nav-item', href: n.hash, title: `${n.label} (${n.keys})` }, icon(n.ico, 18), h('span', null, n.label));
    if (n.id === 'workspace') {
      runBadge = h('span', { class: 'nav-badge', hidden: true });
      a.append(runBadge);
    }
    navEls[n.id] = a;
    nav.append(a);
  }
  const foot = h('div', { class: 'nav-foot' });
  for (const n of [
    { id: 'settings', label: 'Settings', ico: 'settings', hash: '#/settings' },
    { id: 'about', label: 'About', ico: 'info', hash: '#/about' },
  ]) {
    const a = h('a', { class: 'nav-item', href: n.hash }, icon(n.ico, 18), h('span', null, n.label));
    navEls[n.id] = a;
    foot.append(a);
  }

  const sidebar = h(
    'aside',
    { class: 'sidebar' },
    h('div', { class: 'brand', onClick: () => (location.hash = '#/home') }, logoMark(30), h('div', { class: 'brand-text' }, h('strong', null, 'Reversey'), h('small', null, `REA ${state.info.reaVersion}`))),
    nav,
    h('div', { class: 'sidebar-spacer' }),
    foot,
  );

  const search = h(
    'button',
    { class: 'search-pill', type: 'button', onClick: () => openPalette() },
    icon('search', 15),
    h('span', null, 'Search tools, runs and pages'),
    h('span', { class: 'kbds' }, kbd('Ctrl'), kbd('K')),
  );
  const topbar = h('header', { class: 'topbar' }, search);
  main = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  mount(root, sidebar, h('div', { class: 'content' }, topbar, main));
}

async function route() {
  const hash = location.hash || '#/home';
  const my = ++token;
  for (const r of ROUTES) {
    const m = hash.match(r.re);
    if (!m) continue;
    try {
      cleanup?.();
    } catch (e) {
      console.error(e);
    }
    cleanup = null;
    for (const [id, el] of Object.entries(navEls)) el.classList.toggle('active', id === r.nav);
    clear(main);
    main.scrollTop = 0;
    try {
      const out = await r.view({ params: m.slice(1), hash });
      if (my !== token) return out?.cleanup?.();
      main.append(out.el);
      main.classList.remove('enter');
      void main.offsetWidth;
      main.classList.add('enter');
      cleanup = out.cleanup || null;
    } catch (err) {
      console.error(err);
      main.append(h('div', { class: 'pad' }, h('div', { class: 'callout callout-bad' }, `Something went wrong: ${err.message}`)));
    }
    return;
  }
  location.hash = '#/home';
}

function updateRunBadge() {
  const n = activeRuns().length;
  runBadge.hidden = n === 0;
  runBadge.textContent = String(n);
}

function installShortcuts() {
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
    } else if (mod && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      openTargetDialog('any');
    } else if (mod && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      location.hash = NAV[Number(e.key) - 1].hash;
    }
  });
}

// Global drag & drop: dropping anywhere opens the target page.
function installDropZone() {
  let depth = 0;
  const overlay = h('div', { class: 'drop-overlay' }, h('div', { class: 'drop-card' }, icon('upload', 34), h('strong', null, 'Drop to analyze'), h('span', null, 'Files, folders, APKs, ASARs, binaries…')));
  document.body.append(overlay);
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    overlay.classList.add('show');
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.classList.remove('show');
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('show');
  });
  window.reversey.onDrop((paths) => {
    const claimed = getActiveDropField();
    if (claimed) return claimed.onPaths(paths);
    if (paths.length > 1) toast(`Opened the first of ${paths.length} items`, 'info');
    openTarget(paths[0]);
  });
}

async function maybeConsent() {
  if (state.settings.consentVersion >= state.info.consentVersion) return;
  await new Promise((resolve) => {
    const box = h('input', { type: 'checkbox', id: 'consent-check' });
    const go = btn('Get started', { variant: 'primary', disabled: true });
    box.addEventListener('change', () => (go.disabled = !box.checked));
    const m = modal({
      title: 'Before you begin',
      width: 560,
      dismissible: false,
      body: [
        h('p', { class: 'modal-msg' }, 'Reversey is a friendly front-end for REA, a local reverse-engineering toolkit. Analysis runs on this computer; nothing is uploaded.'),
        h(
          'ul',
          { class: 'consent-list' },
          h('li', null, 'Use it for lawful work: security research, interoperability, preservation, education, and software you own or are authorized to examine.'),
          h('li', null, 'Do not use it to bypass DRM, license checks, anti-cheat or authentication, or to copy protected code.'),
          h('li', null, 'Some tools execute or attach to programs and devices. Reversey asks before it does so — prefer a disposable VM for untrusted targets.'),
          h('li', null, 'Results can be incomplete or wrong. Verify consequential conclusions against the evidence.'),
        ),
        h('label', { class: 'check-row', for: 'consent-check' }, box, h('span', null, 'I will only analyze software I own or have permission to examine, and I accept responsibility for how I use these tools.')),
      ],
      actions: [
        () =>
          btn('Read full disclaimer', {
            onClick: () => (location.hash = '#/about'),
          }),
        (close) => {
          go.addEventListener('click', async () => {
            await updateSettings({ consentVersion: state.info.consentVersion });
            close();
            resolve();
          });
          return go;
        },
      ],
    });
    void m;
  });
}

async function main_() {
  await bootstrap();
  applyAppearance();
  window.reversey.onThemeChanged(() => applyAppearance());
  on('settings', applyAppearance);
  buildShell();
  installShortcuts();
  installDropZone();
  on('runs', updateRunBadge);
  updateRunBadge();
  window.addEventListener('hashchange', route);
  await route();
  document.body.classList.add('ready');
  await maybeConsent();
}

main_().catch((e) => {
  console.error(e);
  document.getElementById('app').textContent = `Reversey failed to start: ${e.message}`;
});
