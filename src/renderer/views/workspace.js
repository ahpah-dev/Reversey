import { h, icon, debounce } from '../lib/dom.js';
import { state, on, runsList } from '../lib/state.js';
import { btn, statusBadge, riskBadge, fmtBytes, fmtDuration, fmtTime, basename, empty, confirmDialog, iconBtn, toast } from '../lib/ui.js';

export async function workspaceView() {
  let filter = 'all';
  let query = '';
  const list = h('div', { class: 'run-list' });
  const pills = h('div', { class: 'pills' });
  const input = h('input', { class: 'input search-input', placeholder: 'Search runs by command or target…', spellcheck: 'false', 'aria-label': 'Search runs' });
  const summary = h('span', { class: 'muted small' });

  function draw() {
    const all = runsList();
    const counts = { all: all.length, ok: 0, error: 0, running: 0, cancelled: 0 };
    for (const r of all) counts[r.status] = (counts[r.status] || 0) + 1;
    pills.replaceChildren(
      ...[
        ['all', 'All'],
        ['running', 'Running'],
        ['ok', 'Completed'],
        ['error', 'Failed'],
        ['cancelled', 'Cancelled'],
      ].map(([id, label]) => {
        const b = h('button', { class: `pill ${filter === id ? 'active' : ''}`, type: 'button' }, label, h('span', { class: 'pill-n' }, counts[id] || 0));
        b.addEventListener('click', () => {
          filter = id;
          draw();
        });
        return b;
      }),
    );
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = all.filter((r) => (filter === 'all' || r.status === filter) && terms.every((t) => `${r.command} ${r.targetPath || ''} ${r.title || ''}`.toLowerCase().includes(t)));
    summary.textContent = `${rows.length} run${rows.length === 1 ? '' : 's'}`;
    list.replaceChildren();
    if (!all.length) {
      list.append(empty('history', 'No runs yet', 'Results of every analysis are saved here so you can come back to them.', btn('Analyze something', { variant: 'primary', ico: 'scan', onClick: () => (location.hash = '#/home') })));
      return;
    }
    if (!rows.length) {
      list.append(empty('search', 'No matching runs', 'Adjust the filter or search.'));
      return;
    }
    let lastDay = '';
    for (const r of rows) {
      const day = new Date(r.startedAt).toDateString() === new Date().toDateString() ? 'Today' : new Date(r.startedAt).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
      if (day !== lastDay) {
        lastDay = day;
        list.append(h('div', { class: 'day-label' }, day));
      }
      const row = h(
        'div',
        { class: 'run-row', tabindex: '0', role: 'link' },
        statusBadge(r.status),
        h('div', { class: 'run-row-main' }, h('code', null, r.command), h('small', { class: 'ellipsis', title: r.targetPath || '' }, r.targetPath ? basename(r.targetPath) : r.title || '')),
        riskBadge(r.risk),
        h('span', { class: 'muted small run-col' }, fmtDuration((r.endedAt || Date.now()) - r.startedAt)),
        h('span', { class: 'muted small run-col' }, fmtBytes(r.outBytes)),
        h('span', { class: 'muted small run-col wide' }, fmtTime(r.startedAt)),
        iconBtn('trash', 'Delete run', async (e) => {
          e.stopPropagation();
          await window.reversey.run.remove(r.id);
          state.runs.delete(r.id);
          draw();
        }),
      );
      row.addEventListener('click', () => (location.hash = `#/run/${r.id}`));
      row.addEventListener('keydown', (e) => e.key === 'Enter' && (location.hash = `#/run/${r.id}`));
      list.append(row);
    }
  }

  input.addEventListener(
    'input',
    debounce(() => {
      query = input.value;
      draw();
    }, 80),
  );

  draw();
  const off = on('runs', debounce(draw, 100));
  const el = h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'page-head row' },
      h('div', null, h('h1', null, 'Workspace'), h('p', { class: 'lede' }, 'Every analysis you run is saved locally. Reopen, compare, export or re-run.')),
      btn('Clear all', {
        ico: 'trash',
        onClick: async () => {
          if (!runsList().length) return;
          if (await confirmDialog({ title: 'Clear all runs?', message: 'All saved results and logs will be deleted from disk. Running jobs are kept.', confirmLabel: 'Clear', tone: 'danger' })) {
            await window.reversey.run.clear();
            for (const r of runsList()) if (r.status !== 'running') state.runs.delete(r.id);
            draw();
            toast('Workspace cleared', 'good');
          }
        },
      }),
    ),
    h('div', { class: 'toolbar' }, input, summary),
    pills,
    list,
  );
  return { el, cleanup: off };
}
