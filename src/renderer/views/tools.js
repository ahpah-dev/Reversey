import { h, icon, debounce } from '../lib/dom.js';
import { state, updateSettings } from '../lib/state.js';
import { riskBadge, empty } from '../lib/ui.js';

let lastCat = 'all';
let lastQuery = '';

export async function toolsView({ params }) {
  const qp = new URLSearchParams(params[0] || '');
  let cat = qp.get('cat') || lastCat;
  let query = qp.get('q') ?? lastQuery;
  const { catalog } = state;
  const favs = () => new Set(state.settings.favorites || []);

  const input = h('input', { class: 'input search-input', placeholder: 'Filter 170+ tools by name or description…', value: query, 'aria-label': 'Filter tools', spellcheck: 'false' });
  const pills = h('div', { class: 'pills', role: 'tablist' });
  const grid = h('div', { class: 'tool-grid' });
  const count = h('span', { class: 'muted small' });

  const counts = new Map();
  for (const c of catalog.commands) counts.set(c.category, (counts.get(c.category) || 0) + 1);

  function drawPills() {
    pills.replaceChildren();
    const mk = (id, label, n, ico) => {
      const b = h('button', { class: `pill ${cat === id ? 'active' : ''}`, type: 'button', role: 'tab', 'aria-selected': cat === id ? 'true' : 'false' }, ico ? icon(ico, 14) : null, label, h('span', { class: 'pill-n' }, n));
      b.addEventListener('click', () => {
        cat = id;
        lastCat = id;
        drawPills();
        draw();
      });
      return b;
    };
    pills.append(mk('all', 'All', catalog.commands.length));
    const f = favs().size;
    if (f) pills.append(mk('fav', 'Favorites', f, 'star'));
    for (const c of catalog.categories) if (counts.get(c.id)) pills.append(mk(c.id, c.name, counts.get(c.id), c.icon));
  }

  function match(c, terms) {
    if (cat === 'fav' && !favs().has(c.name)) return false;
    if (cat !== 'all' && cat !== 'fav' && c.category !== cat) return false;
    const hay = `${c.name} ${c.description}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  }

  function draw() {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = catalog.commands.filter((c) => match(c, terms));
    count.textContent = `${list.length} tool${list.length === 1 ? '' : 's'}`;
    grid.replaceChildren();
    if (!list.length) {
      grid.append(empty('search', 'No tools match', 'Try a broader search or another category.'));
      return;
    }
    const fv = favs();
    for (const c of list) {
      const catInfo = catalog.categories.find((x) => x.id === c.category);
      const star = h('button', { class: `star ${fv.has(c.name) ? 'on' : ''}`, type: 'button', title: fv.has(c.name) ? 'Remove favorite' : 'Add favorite', 'aria-label': 'Toggle favorite' }, icon('star', 15));
      star.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const set = favs();
        set.has(c.name) ? set.delete(c.name) : set.add(c.name);
        await updateSettings({ favorites: [...set] });
        drawPills();
        draw();
      });
      grid.append(
        h(
          'a',
          { class: 'tool-card', href: `#/tool/${c.name}` },
          h('div', { class: 'tool-card-top' }, h('span', { class: 'tool-ico' }, icon(catInfo?.icon || 'wrench', 16)), h('code', null, c.name), star),
          h('p', null, c.description),
          h('div', { class: 'tool-card-foot' }, h('span', { class: 'muted small' }, c.args.length ? c.args.map((a) => `‹${a.key}›`).join(' ') : 'no inputs'), riskBadge(c.risk)),
        ),
      );
    }
  }

  input.addEventListener(
    'input',
    debounce(() => {
      query = input.value;
      lastQuery = query;
      draw();
    }, 80),
  );

  drawPills();
  draw();
  const el = h(
    'div',
    { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Tools'), h('p', { class: 'lede' }, 'Every REA capability, with a generated form for each. Pick one, fill in the inputs, run it.')),
    h('div', { class: 'toolbar' }, input, count),
    pills,
    grid,
  );
  return { el };
}
