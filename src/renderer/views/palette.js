import { h, icon } from '../lib/dom.js';
import { state, runsList, updateSettings } from '../lib/state.js';
import { basename, relTime } from '../lib/ui.js';
import { openTargetDialog } from '../lib/nav.js';

let open = false;

function items() {
  const list = [
    { group: 'Go to', title: 'Analyze', ico: 'scan', run: () => (location.hash = '#/home') },
    { group: 'Go to', title: 'Tools', ico: 'wrench', run: () => (location.hash = '#/tools') },
    { group: 'Go to', title: 'Workspace', sub: 'History of runs', ico: 'history', run: () => (location.hash = '#/workspace') },
    { group: 'Go to', title: 'Health', sub: 'Engines and readiness', ico: 'heart', run: () => (location.hash = '#/health') },
    { group: 'Go to', title: 'Settings', ico: 'settings', run: () => (location.hash = '#/settings') },
    { group: 'Go to', title: 'About & responsible use', ico: 'info', run: () => (location.hash = '#/about') },
    { group: 'Actions', title: 'Open file or folder…', sub: 'Ctrl+O', ico: 'folder', run: () => openTargetDialog('any') },
    {
      group: 'Actions',
      title: 'Toggle light / dark theme',
      ico: 'sun',
      run: () => updateSettings({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }),
    },
  ];
  for (const r of runsList().slice(0, 25)) {
    list.push({
      group: 'Recent runs',
      title: r.command,
      sub: `${r.targetPath ? basename(r.targetPath) + ' · ' : ''}${relTime(r.startedAt)}`,
      ico: r.status === 'ok' ? 'check' : r.status === 'running' ? 'activity' : 'alert',
      run: () => (location.hash = `#/run/${r.id}`),
    });
  }
  for (const c of state.catalog.commands) {
    list.push({ group: 'Tools', title: c.name, sub: c.description, ico: state.catalog.categories.find((x) => x.id === c.category)?.icon || 'wrench', run: () => (location.hash = `#/tool/${c.name}`), hay: `${c.name} ${c.description}` });
  }
  return list;
}

function score(item, q) {
  const hay = (item.hay || `${item.title} ${item.sub || ''}`).toLowerCase();
  const title = item.title.toLowerCase();
  let s = 0;
  for (const term of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (title.startsWith(term)) s += 6;
    else if (title.includes(term)) s += 4;
    else if (hay.includes(term)) s += 1;
    else return 0;
  }
  return s;
}

export function openPalette() {
  if (open) return;
  open = true;
  const all = items();
  let results = all.slice(0, 40);
  let sel = 0;

  const input = h('input', { class: 'pal-input', placeholder: 'Type a tool, page or run…', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Command palette' });
  const list = h('div', { class: 'pal-list', role: 'listbox' });
  const box = h('div', { class: 'pal' }, h('div', { class: 'pal-head' }, icon('search', 18), input), list);
  const overlay = h('div', { class: 'overlay overlay-top' }, box);

  const close = () => {
    open = false;
    overlay.classList.remove('in');
    setTimeout(() => overlay.remove(), 150);
  };

  const draw = () => {
    list.replaceChildren();
    if (!results.length) list.append(h('div', { class: 'pal-empty' }, 'No matches'));
    let lastGroup = '';
    results.forEach((r, i) => {
      if (r.group !== lastGroup) {
        lastGroup = r.group;
        list.append(h('div', { class: 'pal-group' }, r.group));
      }
      const row = h(
        'div',
        { class: `pal-item ${i === sel ? 'sel' : ''}`, role: 'option', 'aria-selected': i === sel ? 'true' : 'false' },
        icon(r.ico, 16),
        h('span', { class: 'pal-title' }, r.title),
        r.sub ? h('span', { class: 'pal-sub' }, r.sub) : null,
      );
      row.addEventListener('mousemove', () => {
        if (sel !== i) {
          sel = i;
          draw();
        }
      });
      row.addEventListener('click', () => choose(i));
      list.append(row);
    });
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };

  const choose = (i) => {
    const r = results[i];
    if (!r) return;
    close();
    r.run();
  };

  input.addEventListener('input', () => {
    const q = input.value.trim();
    results = q
      ? all
          .map((it) => [it, score(it, q)])
          .filter(([, s]) => s > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 50)
          .map(([it]) => it)
      : all.slice(0, 40);
    sel = 0;
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sel = Math.min(results.length - 1, sel + 1);
      draw();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(0, sel - 1);
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(sel);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  overlay.addEventListener('mousedown', (e) => e.target === overlay && close());

  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('in'));
  draw();
  input.focus();
}
