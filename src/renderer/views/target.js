import { h, icon } from '../lib/dom.js';
import { state, on, runsList, startRun } from '../lib/state.js';
import { btn, badge, riskBadge, statusBadge, fmtBytes, fmtDuration, relTime, empty } from '../lib/ui.js';
import { openTargetDialog } from '../lib/nav.js';

const OPTION_PRESETS = {
  'analyze-javascript-application': { detail: 'summary' },
};

const KIND_ICON = {
  pe: 'cpu', dotnet: 'package', elf: 'cpu', macho: 'cpu', asar: 'braces', 'js-app': 'braces', 'electron-install': 'braces',
  'app-bundle': 'package', apk: 'smartphone', jar: 'package', ipa: 'smartphone', zip: 'package', wasm: 'binary', sqlite: 'box',
  gguf: 'sparkles', safetensors: 'sparkles', har: 'globe', saz: 'globe', pcap: 'globe', ips: 'alert', pyc: 'binary', beam: 'binary',
  dtb: 'chip', uf2: 'chip', firmware: 'chip', dir: 'folder', unknown: 'file', evidence: 'shield',
};

export async function targetView({ params }) {
  const q = new URLSearchParams(params[0] || '');
  const targetPath = q.get('path');
  let info;
  try {
    info = await window.reversey.target.detect(targetPath);
  } catch (e) {
    return {
      el: h('div', { class: 'page' }, empty('alert', 'Can’t open that target', e.message, btn('Choose another…', { variant: 'primary', onClick: () => openTargetDialog('any') }))),
    };
  }

  const cardRefs = new Map();

  const latestFor = (command) => runsList().find((r) => r.command === command && r.targetPath === info.path);

  function paintCard(sug) {
    const ref = cardRefs.get(sug.key);
    if (!ref) return;
    const last = latestFor(sug.command);
    ref.status.replaceChildren();
    ref.actions.replaceChildren();
    if (last) {
      ref.status.append(statusBadge(last.status), h('span', { class: 'muted small' }, last.status === 'running' ? 'working…' : `${fmtDuration((last.endedAt || Date.now()) - last.startedAt)} · ${relTime(last.startedAt)}`));
      ref.actions.append(btn(last.status === 'running' ? 'Watch' : 'View result', { size: 'sm', ico: 'eye', onClick: () => (location.hash = `#/run/${last.id}`) }));
    }
    const running = last?.status === 'running';
    ref.actions.append(
      btn(last ? 'Run again' : 'Run', {
        size: 'sm',
        variant: last ? 'default' : 'primary',
        ico: 'play',
        disabled: running,
        onClick: () => run(sug),
      }),
    );
    ref.card.classList.toggle('done', last?.status === 'ok');
    ref.card.classList.toggle('busy', running);
  }

  async function run(sug, navigate = true) {
    return startRun(sug.command, sug.args, OPTION_PRESETS[sug.command] || {}, { targetPath: info.path, title: sug.title, navigate });
  }

  const cards = info.suggestions.map((sug) => {
    const status = h('div', { class: 'card-status' });
    const actions = h('div', { class: 'card-actions' });
    const cmd = state.byName.get(sug.command);
    const card = h(
      'article',
      { class: `rec-card ${sug.quick ? '' : 'rec-adv'}` },
      h(
        'div',
        { class: 'rec-top' },
        h('h4', null, sug.title),
        sug.quick ? null : badge('Needs setup', 'warn'),
        riskBadge(cmd?.risk),
      ),
      h('code', { class: 'rec-cmd' }, sug.command),
      h('p', null, sug.why),
      h(
        'div',
        { class: 'rec-foot' },
        status,
        h(
          'div',
          { class: 'rec-btns' },
          actions,
          btn('', {
            size: 'sm',
            ico: 'settings',
            title: 'Customize options',
            onClick: () => {
              state.prefill = { command: sug.command, args: sug.args, options: OPTION_PRESETS[sug.command] || {}, targetPath: info.path };
              location.hash = `#/tool/${sug.command}`;
            },
          }),
        ),
      ),
    );
    cardRefs.set(sug.key, { card, status, actions });
    paintCard(sug);
    return card;
  });

  const quickOnes = info.suggestions.filter((s) => s.quick && s.risk === 'safe');
  const head = h(
    'div',
    { class: 'target-head' },
    h('div', { class: 'target-ico' }, icon(KIND_ICON[info.kinds[0]] || 'file', 28)),
    h(
      'div',
      { class: 'target-meta' },
      h('h1', { title: info.name }, info.name),
      h('div', { class: 'target-path mono', title: info.path }, info.path),
      h(
        'div',
        { class: 'chips' },
        info.kindLabels.map((l, i) => badge(l, i === 0 ? 'accent' : 'neutral')),
        info.size !== null ? badge(fmtBytes(info.size)) : badge('Folder'),
      ),
    ),
    h(
      'div',
      { class: 'target-actions' },
      btn('Run all quick scans', {
        variant: 'primary',
        ico: 'bolt',
        disabled: !quickOnes.length,
        onClick: async () => {
          for (const s of quickOnes) run(s, false);
        },
      }),
      btn('Reveal', { ico: 'folder', onClick: () => window.reversey.shell.reveal(info.path) }),
      btn('Change…', { ico: 'refresh', onClick: () => openTargetDialog('any') }),
    ),
  );

  const el = h(
    'div',
    { class: 'page' },
    h('a', { class: 'crumb', href: '#/home' }, icon('chevron', 14, 'flip'), 'Analyze'),
    head,
    h('div', { class: 'block' }, h('h3', { class: 'eyebrow' }, 'Recommended analyses'), h('div', { class: 'rec-grid' }, cards)),
    h(
      'div',
      { class: 'footer-note' },
      icon('info', 14),
      h('span', null, 'Recommendations come from the file’s signature and name. Everything in REA is also available under '),
      h('a', { href: '#/tools' }, 'Tools'),
      h('span', null, '.'),
    ),
  );

  const off = on('runs', () => info.suggestions.forEach(paintCard));
  return { el, cleanup: off };
}
