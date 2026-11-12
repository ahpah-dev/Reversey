import { h, icon } from '../lib/dom.js';
import { state } from '../lib/state.js';
import { btn, kv, section } from '../lib/ui.js';
import { logoMark } from './logo.js';

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// Tiny, safe markdown subset for the bundled disclaimer.
function renderMarkdown(md) {
  const out = h('div', { class: 'md' });
  const inline = (t) =>
    esc(t)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  let ul = null;
  let para = [];
  const flush = () => {
    if (para.length) out.append(h('p', { html: inline(para.join(' ')) }));
    para = [];
  };
  for (const line of md.split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) {
      flush();
      ul = null;
      const level = line.match(/^#+/)[0].length;
      out.append(h(level === 1 ? 'h3' : 'h4', null, line.replace(/^#+\s*/, '')));
    } else if (/^[-*]\s/.test(line)) {
      flush();
      if (!ul) {
        ul = h('ul');
        out.append(ul);
      }
      ul.append(h('li', { html: inline(line.replace(/^[-*]\s/, '')) }));
    } else if (/^\s+\S/.test(line) && ul) {
      ul.lastChild.innerHTML += ` ${inline(line.trim())}`;
    } else if (!line.trim()) {
      flush();
      ul = null;
    } else para.push(line.trim());
  }
  flush();
  return out;
}

export async function aboutView() {
  const lic = await window.reversey.license();
  const i = state.info;
  const link = (label, url) => h('a', { href: '#', onClick: (e) => { e.preventDefault(); window.reversey.shell.external(url); } }, label, ' ', icon('external', 12));

  const el = h(
    'div',
    { class: 'page page-narrow' },
    h('div', { class: 'about-hero' }, logoMark(72), h('div', null, h('h1', null, 'Reversey'), h('p', { class: 'lede' }, 'A polished desktop home for REA — Reverse Engineer Anything.'), h('div', { class: 'row-gap' }, btn('rea.tools', { size: 'sm', ico: 'external', onClick: () => window.reversey.shell.external('https://rea.tools/') }), btn('REA on GitHub', { size: 'sm', ico: 'external', onClick: () => window.reversey.shell.external('https://github.com/morluto/rea') })))),
    section(
      'Versions',
      h('div', { class: 'card' }, kv([
        ['Reversey', i.version],
        ['REA engine', `rea-agents ${i.reaVersion}`],
        ['Electron', i.electron],
        ['Node (analysis runtime)', i.node],
        ['Chromium', i.chrome],
        ['Platform', `${i.platform} ${i.arch}`],
      ])),
    ),
    section(
      'Credits',
      h(
        'div',
        { class: 'card' },
        h('p', null, 'Reversey is an independent interface built on ', link('REA', 'https://github.com/morluto/rea'), ', the MIT-licensed project by morluto and contributors. Reversey bundles the unmodified ', h('code', null, 'rea-agents'), ' package and runs it locally; every analysis capability comes from REA and the tools it integrates.'),
        h('p', { class: 'muted small' }, 'Reversey’s own code is public domain (Unlicense). REA is © 2026 morluto under the MIT License, reproduced below.'),
        h('p', { class: 'muted small' }, 'Reversey is not affiliated with or endorsed by the REA project, Hopper, Ghidra, IDA, JEB or any other third-party tool. Those tools keep their own licenses; you must obtain them legally.'),
      ),
    ),
    section('Responsible use', h('div', { class: 'card md-card' }, renderMarkdown(lic.disclaimer))),
    section(
      'License',
      h('details', { class: 'card details' }, h('summary', null, icon('chevron', 14, 'sum-caret'), 'REA — MIT License'), h('pre', { class: 'plain-pre' }, lic.mit)),
    ),
  );
  return { el };
}
