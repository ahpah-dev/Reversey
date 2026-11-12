// Overview tab: a human-friendly reading of a JSON result (Evidence, pages, tables).
import { h } from '../lib/dom.js';
import { state, startRun } from '../lib/state.js';
import { btn, badge, kv, copyText, section } from '../lib/ui.js';
import { summarizeShape, isContainer } from '../lib/json-tree.js';
import { icon } from '../lib/dom.js';

const CONFIDENCE_TONE = { observed: 'good', derived: 'info', inferred: 'warn', speculative: 'bad' };
const ITEM_KEYS = ['items', 'rows', 'records', 'occurrences'];
const PREFERRED = ['path', 'name', 'kind', 'id', 'node_id', 'type', 'status', 'operation', 'format', 'size'];

// Evidence may be the document itself or wrapped (e.g. summary-mode analyses).
export function findEvidence(parsed) {
  if (!isContainer(parsed)) return null;
  if (parsed.evidence_id && parsed.subject) return { ev: parsed, base: [] };
  if (parsed.summary?.evidence_id && parsed.summary?.subject) return { ev: parsed.summary, base: ['summary'] };
  return null;
}

function limitsBlock(list) {
  const LIM = 3;
  const ul = h('ul', null);
  let open = list.length <= LIM;
  const draw = () => ul.replaceChildren(...(open ? list : list.slice(0, LIM)).map((l) => h('li', null, l)));
  draw();
  const wrap = h('div', { class: 'limits' }, h('div', { class: 'eyebrow' }, `Limitations (${list.length})`), ul);
  if (list.length > LIM) {
    const more = h('button', { class: 'jt-more more-btn', type: 'button' }, `Show all ${list.length}`);
    more.addEventListener('click', () => {
      open = !open;
      draw();
      more.textContent = open ? 'Show fewer' : `Show all ${list.length}`;
    });
    wrap.append(more);
  }
  return wrap;
}

function findItems(nr) {
  if (!isContainer(nr)) return null;
  for (const k of ITEM_KEYS) {
    const v = nr[k];
    if (Array.isArray(v) && v.length && isContainer(v[0]) && !Array.isArray(v[0])) return { key: k, rows: v };
  }
  return null;
}

function cell(v) {
  if (v === null || v === undefined) return h('span', { class: 'muted' }, '—');
  if (isContainer(v)) return h('span', { class: 'muted mono' }, Array.isArray(v) ? `[${v.length}]` : `{${Object.keys(v).length}}`);
  const s = String(v);
  return h('span', { class: /^[\w-]{24,}$/.test(s) ? 'mono muted' : '', title: s.length > 60 ? s : undefined }, s.length > 60 ? `${s.slice(0, 58)}…` : s);
}

function itemsTable(nr, basePath, meta, goTree) {
  const found = findItems(nr);
  if (!found) return null;
  const { rows, key } = found;
  const cols = [];
  for (const row of rows.slice(0, 5)) for (const k of Object.keys(row)) if (!cols.includes(k)) cols.push(k);
  const rank = (c) => (PREFERRED.indexOf(c) === -1 ? 99 : PREFERRED.indexOf(c));
  cols.sort((a, b) => rank(a) - rank(b));
  const shown = cols.slice(0, 6);
  const shownRows = rows.slice(0, 100);

  // Paging for analysis views: re-run the same projection at another offset.
  let pager = null;
  const cov = nr.coverage;
  const view = nr.view;
  if (meta.command === 'inspect-analysis-view' && view?.kind === 'page' && cov) {
    let base = null;
    try {
      base = JSON.parse(meta.args.inputJson);
    } catch {
      /* file-based request: no paging */
    }
    if (base?.view) {
      const go = (offset) =>
        startRun('inspect-analysis-view', { inputJson: JSON.stringify({ ...base, view: { ...base.view, offset } }) }, {}, { targetPath: meta.targetPath, title: `${view.collection} (offset ${offset})` });
      const off = view.offset || 0;
      const lim = view.limit || rows.length;
      pager = h(
        'div',
        { class: 'pager-bar' },
        h('span', { class: 'muted small' }, `Showing ${off + 1}–${off + rows.length}${cov.total ? ` of ${cov.total.toLocaleString()}` : ''}`),
        h(
          'div',
          { class: 'row-gap' },
          btn('Previous', { size: 'sm', disabled: off <= 0, onClick: () => go(Math.max(0, off - lim)) }),
          btn('Next', { size: 'sm', variant: 'primary', disabled: cov.next_offset === null || cov.next_offset === undefined, onClick: () => go(cov.next_offset) }),
        ),
      );
    }
  }
  const name = view?.collection || key;
  const title = `${name[0].toUpperCase()}${name.slice(1)}`;
  const total = cov?.total && cov.total > rows.length ? ` of ${cov.total.toLocaleString()}` : '';
  return section(
    `${title} (${rows.length}${total})`,
    h(
      'div',
      { class: 'card table-card' },
      h(
        'div',
        { class: 'table-scroll' },
        h(
          'table',
          { class: 'table' },
          h('thead', null, h('tr', null, shown.map((c) => h('th', null, c)))),
          h('tbody', null, shownRows.map((row, i) => h('tr', { class: 'clickable', onClick: () => goTree([...basePath, key, i]) }, shown.map((c) => h('td', null, cell(row[c])))))),
        ),
      ),
      rows.length > 100 ? h('div', { class: 'pager-bar' }, h('span', { class: 'muted small' }, `First 100 of ${rows.length} shown — see Explorer for all.`)) : null,
      pager,
    ),
  );
}

// Follow-up views over a saved Evidence file (summary delivery of the JS analyzer).
export function appExplorer(meta, evidenceFile) {
  const view = (kind, extra = {}) => JSON.stringify({ source: { kind: 'evidence-file', path: evidenceFile.path }, view: { kind, ...extra } });
  const open = (title, inputJson) => startRun('inspect-analysis-view', { inputJson }, {}, { targetPath: meta.targetPath, title });
  return h(
    'div',
    { class: 'card explorer-card' },
    h('div', { class: 'ev-head' }, h('div', null, h('span', { class: 'eyebrow' }, 'Application explorer'), h('h3', null, 'Explore the reconstructed application')), icon('braces', 22)),
    h('p', { class: 'muted' }, 'The complete Evidence is saved on disk. Project focused views from it without loading hundreds of megabytes.'),
    h(
      'div',
      { class: 'row-gap' },
      btn('Summary', { variant: 'primary', ico: 'eye', onClick: () => open('Application summary', view('summary')) }),
      btn('Modules', { ico: 'list', onClick: () => open('Modules', view('page', { collection: 'modules', offset: 0, limit: 32 })) }),
      btn('Routes', { ico: 'globe', onClick: () => open('Routes', view('javascript-routes', { collection: 'routes', limit: 32 })) }),
      btn('Custom view…', {
        ico: 'settings',
        onClick: () => {
          state.prefill = { command: 'inspect-analysis-view', args: { inputJson: view('summary') }, options: {}, targetPath: meta.targetPath };
          location.hash = '#/tool/inspect-analysis-view';
        },
      }),
      btn('Reveal evidence file', { ico: 'folder', onClick: () => window.reversey.shell.reveal(evidenceFile.path) }),
    ),
  );
}

// Headline numbers from an application "summary" projection.
function statTiles(nr, goTree, nrPath) {
  const sum = nr?.summary;
  if (!isContainer(sum)) return null;
  const st = sum.statistics || {};
  const el = sum.electron || {};
  const ipc = el.ipc || {};
  const defs = [
    ['Source files', st.relevant_files, ['summary', 'statistics']],
    ['JS files parsed', st.parsed_javascript_files, ['summary', 'statistics']],
    ['Modules', st.modules, ['summary', 'statistics']],
    ['Findings', st.findings, ['summary', 'statistics']],
    ['Browser windows', el.browser_windows, ['summary', 'electron']],
    ['Preload scripts', el.preload_entrypoints, ['summary', 'electron']],
    ['Context-bridge APIs', el.context_bridge_apis, ['summary', 'electron']],
    ['IPC operations', ipc.operations, ['summary', 'electron', 'ipc']],
    ['IPC channels', ipc.literal_channels, ['summary', 'electron', 'ipc']],
    ['Main handlers', ipc.main_handlers, ['summary', 'electron', 'ipc']],
    ['Native add-ons', el.native_addon_bindings, ['summary', 'electron']],
    ['Parse failures', st.parse_failures, ['summary', 'statistics']],
  ].filter(([, v]) => typeof v === 'number');
  if (!defs.length) return null;
  return section(
    'Application at a glance',
    h(
      'div',
      { class: 'stat-grid' },
      defs.map(([label, v, path]) => h('button', { class: `stat ${v === 0 ? 'zero' : ''}`, type: 'button', title: 'Open in Explorer', onClick: () => goTree([...nrPath, ...path]) }, h('strong', null, v.toLocaleString()), h('span', null, label))),
    ),
  );
}

export function overview(parsed, meta, data, evidenceFile, goTree) {
  const stack = h('div', { class: 'stack' });
  if (evidenceFile) stack.append(appExplorer(meta, evidenceFile));
  if (!isContainer(parsed)) {
    stack.append(h('div', { class: 'card' }, h('pre', { class: 'plain-pre' }, JSON.stringify(parsed))));
    return stack;
  }

  const found = findEvidence(parsed);
  const ev = found?.ev || null;
  const evBase = found?.base || [];
  const nr0 = ev ? ev.normalized_result : parsed;
  const nrPath0 = ev ? [...evBase, 'normalized_result'] : [];
  const tiles = statTiles(nr0, goTree, nrPath0);
  if (tiles) stack.append(tiles);
  // Data-first: a page of rows matters more than the provenance card above it.
  const leadTable = itemsTable(nr0, nrPath0, meta, goTree);
  if (leadTable) stack.append(leadTable);
  if (ev) {
    const s = ev.subject || {};
    stack.append(
      h(
        'div',
        { class: 'card evidence-card' },
        h(
          'div',
          { class: 'ev-head' },
          h('div', null, h('span', { class: 'eyebrow' }, 'Evidence'), h('h3', null, s.name || 'Subject')),
          h('div', { class: 'chips' }, ev.confidence ? badge(ev.confidence, CONFIDENCE_TONE[ev.confidence] || 'neutral', 'shield') : null, ev.authority ? badge(ev.authority) : null),
        ),
        kv([
          ['Format', s.format],
          ['Architecture', s.architecture],
          ['Operation', ev.operation],
          ['Provider', ev.provider ? `${ev.provider.name || ev.provider.id}${ev.provider.version ? ` · v${ev.provider.version}` : ''}` : null],
          ['SHA-256', s.digest?.sha256 ? h('span', { class: 'mono hash', title: 'Click to copy', onClick: () => copyText(s.digest.sha256, 'Hash copied') }, s.digest.sha256) : null],
          ['Path', s.local_path ? h('span', { class: 'mono' }, s.local_path) : null],
          ['Evidence ID', h('span', { class: 'mono hash', onClick: () => copyText(ev.evidence_id, 'ID copied') }, ev.evidence_id)],
        ]),
        ev.limitations?.length ? limitsBlock(ev.limitations) : null,
      ),
    );
  }

  const nr = ev ? ev.normalized_result : parsed;
  const nrPath = ev ? [...evBase, 'normalized_result'] : [];

  if (nr?.coverage?.status) {
    const c = nr.coverage;
    stack.append(h('div', { class: 'chips wrap' }, badge(`coverage: ${c.status}`, c.exhausted ? 'good' : 'warn'), c.examined !== undefined ? badge(`${c.examined} examined${c.total !== undefined ? ` of ${c.total}` : ''}`) : null));
  }

  const substeps = nr?.substeps;
  if (Array.isArray(substeps) && substeps.length) {
    stack.append(
      section(
        'Steps',
        h(
          'div',
          { class: 'card table-card' },
          h(
            'table',
            { class: 'table' },
            h('thead', null, h('tr', null, h('th', null, 'Step'), h('th', null, 'Status'), h('th', null, 'Evidence'))),
            h(
              'tbody',
              null,
              substeps.map((s, i) =>
                h(
                  'tr',
                  { class: 'clickable', onClick: () => goTree([...nrPath, 'substeps', i]) },
                  h('td', { class: 'mono' }, s.operation),
                  h('td', null, badge(s.status || '—', s.status === 'completed' ? 'good' : s.status ? 'warn' : 'neutral')),
                  h('td', { class: 'mono muted' }, (s.evidence_id || '').slice(0, 18) + (s.evidence_id ? '…' : '')),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  const observations = nr?.observations;
  if (Array.isArray(observations) && observations.length) {
    const byKind = new Map();
    for (const o of observations) byKind.set(o.kind || 'observation', (byKind.get(o.kind || 'observation') || 0) + 1);
    stack.append(
      section(
        `Observations (${observations.length})`,
        h('div', { class: 'chips wrap' }, [...byKind.entries()].map(([k, n]) => h('button', { class: 'chip-btn', type: 'button', onClick: () => goTree([...nrPath, 'observations']) }, k, h('span', { class: 'pill-n' }, n)))),
      ),
    );
  }
  if (Array.isArray(nr?.next_probes) && nr.next_probes.length) {
    stack.append(section('Suggested next probes', h('ul', { class: 'probe-list card' }, nr.next_probes.slice(0, 12).map((p) => h('li', null, typeof p === 'string' ? p : h('code', null, JSON.stringify(p)))))));
  }

  const rows = summarizeShape(ev ? nr || ev : parsed);
  const base = ev ? nrPath : [];
  if (rows.length) {
    stack.append(
      section(
        ev ? 'Result structure' : 'Top-level structure',
        h(
          'div',
          { class: 'card table-card' },
          h(
            'table',
            { class: 'table' },
            h('thead', null, h('tr', null, h('th', null, 'Key'), h('th', null, 'Type'), h('th', null, 'Size / sample'))),
            h(
              'tbody',
              null,
              rows.map((r) =>
                h(
                  'tr',
                  { class: 'clickable', onClick: () => goTree([...base, r.key]) },
                  h('td', { class: 'mono' }, String(r.key)),
                  h('td', null, badge(r.type)),
                  h('td', { class: 'muted' }, r.size !== null ? `${r.size.toLocaleString()} ${r.type === 'array' ? 'items' : 'keys'}` : r.sample),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
  return stack;
}
