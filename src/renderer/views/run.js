import { h, icon, debounce } from '../lib/dom.js';
import { state, on, startRun } from '../lib/state.js';
import { btn, badge, statusBadge, riskBadge, kv, fmtBytes, fmtDuration, fmtTime, basename, copyText, confirmDialog, empty, toast, section } from '../lib/ui.js';
import { createTree, searchJson, pathToString, isContainer } from '../lib/json-tree.js';
import { overview, appExplorer } from './overview.js';

const PRETTY_LIMIT = 1.5 * 1024 * 1024;
const HIGHLIGHT_LIMIT = 400 * 1024;

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
function highlightJson(text) {
  return esc(text).replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, (m, str, colon, bool) => {
    if (str) return colon ? `<span class="jt-key">${str}</span>${colon}` : `<span class="jt-str">${str}</span>`;
    if (bool) return `<span class="jt-bool">${m}</span>`;
    if (m === 'null') return `<span class="jt-null">${m}</span>`;
    return `<span class="jt-num">${m}</span>`;
  });
}

function logLines(stderr) {
  const out = [];
  let noise = false;
  for (const line of (stderr || '').split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('{"rea_progress"')) {
      try {
        const p = JSON.parse(line).rea_progress;
        out.push(`▸ ${p.message || p.phase}${p.total ? `  (${p.completed}/${p.total})` : ''}`);
        continue;
      } catch {
        /* fall through */
      }
    }
    noise = true;
    out.push(line);
  }
  return { text: out.join('\n'), noise };
}


export async function runView({ params }) {
  const id = params[0];
  const root = h('div', { class: 'page page-run' });
  let timer = null;
  let disposed = false;

  async function load() {
    let data;
    try {
      data = await window.reversey.run.read(id);
    } catch (e) {
      root.replaceChildren(empty('alert', 'Run not found', 'It may have been deleted.', btn('Back to workspace', { variant: 'primary', onClick: () => (location.hash = '#/workspace') })));
      return;
    }
    if (disposed) return;
    draw(data);
  }

  function draw(data) {
    const { meta } = data;
    clearInterval(timer);
    const cmd = state.byName.get(meta.command);

    // ---- parse -----------------------------------------------------------
    let parsed;
    let parseError = null;
    const text = data.stdout || '';
    if (!data.truncated && text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        parseError = e.message;
      }
    }
    const isErrorEnvelope = parsed && typeof parsed === 'object' && typeof parsed.code === 'string' && typeof parsed.message === 'string' && meta.status === 'error';

    // ---- header ----------------------------------------------------------
    const durationEl = h('span', null, fmtDuration((meta.endedAt || Date.now()) - meta.startedAt));
    const headActions = h('div', { class: 'run-actions' });
    if (meta.status === 'running') {
      headActions.append(
        btn('Cancel', { variant: 'danger', ico: 'stop', onClick: () => window.reversey.run.cancel(id) }),
      );
    } else {
      headActions.append(
        btn('Re-run', { ico: 'refresh', onClick: () => startRun(meta.command, meta.args, meta.options, { global: meta.global, targetPath: meta.targetPath, title: meta.title }) }),
        btn('Edit & re-run', {
          ico: 'settings',
          onClick: () => {
            state.prefill = { command: meta.command, args: meta.args, options: stripAuto(meta), global: meta.global, targetPath: meta.targetPath };
            location.hash = `#/tool/${meta.command}`;
          },
        }),
        btn('Export…', { ico: 'download', disabled: !data.size, onClick: async () => {
          const p = await window.reversey.run.export(id, 'json');
          if (p) toast('Exported', 'good');
        } }),
        btn('', { ico: 'folder', title: 'Show in folder', onClick: () => window.reversey.run.reveal(id) }),
        btn('', {
          ico: 'trash',
          title: 'Delete run',
          onClick: async () => {
            if (await confirmDialog({ title: 'Delete this run?', message: 'The saved output and log will be removed from disk.', confirmLabel: 'Delete', tone: 'danger' })) {
              await window.reversey.run.remove(id);
              state.runs.delete(id);
              location.hash = '#/workspace';
            }
          },
        }),
      );
    }

    const header = h(
      'div',
      { class: 'run-head' },
      h('a', { class: 'crumb', href: meta.targetPath ? `#/target?path=${encodeURIComponent(meta.targetPath)}` : '#/workspace' }, icon('chevron', 14, 'flip'), meta.targetPath ? basename(meta.targetPath) : 'Workspace'),
      h(
        'div',
        { class: 'run-title-row' },
        h('div', { class: 'run-title' }, h('h1', { class: 'mono-title' }, meta.command), h('p', { class: 'lede' }, meta.title || cmd?.description || '')),
        headActions,
      ),
      h(
        'div',
        { class: 'run-meta' },
        statusBadge(meta.status),
        riskBadge(meta.risk),
        h('span', { class: 'meta-item' }, icon('activity', 14), durationEl),
        h('span', { class: 'meta-item' }, icon('history', 14), fmtTime(meta.startedAt)),
        h('span', { class: 'meta-item' }, icon('file', 14), fmtBytes(data.size ?? meta.outBytes)),
        meta.exitCode !== null && meta.exitCode !== 0 ? h('span', { class: 'meta-item bad' }, `exit ${meta.exitCode}`) : null,
      ),
      h('div', { class: 'cli-line' }, icon('terminal', 14), h('code', null, meta.cli), btn('', { size: 'sm', ico: 'copy', title: 'Copy command', onClick: () => copyText(meta.cli, 'Command copied') })),
    );

    root.replaceChildren(header);

    // ---- running ---------------------------------------------------------
    if (meta.status === 'running') {
      const liveMsg = h('p', { class: 'muted' }, 'Large targets can take a while. You can leave this page — the run continues in the background.');
      const bar = h('div', { class: 'meter live-meter', hidden: true }, h('span'));
      const live = h('div', { class: 'live card' }, h('div', { class: 'spinner' }), h('div', { class: 'live-body' }, h('strong', null, 'Analyzing…'), liveMsg, bar), h('div', { class: 'live-stats mono' }));
      root.append(live);
      timer = setInterval(() => {
        durationEl.textContent = fmtDuration(Date.now() - meta.startedAt);
        const m = state.runs.get(id);
        if (m) {
          live.querySelector('.live-stats').textContent = `${fmtBytes(m.outBytes)} output`;
          if (m.progress) {
            liveMsg.textContent = m.progress.message || m.progress.phase;
            if (m.progress.total) {
              bar.hidden = false;
              bar.firstChild.style.width = `${Math.min(100, Math.round((m.progress.completed / m.progress.total) * 100))}%`;
            }
          }
        }
      }, 400);
      return;
    }

    // ---- error envelope --------------------------------------------------
    if (isErrorEnvelope) root.append(errorPanel(parsed));
    else if (meta.status === 'error' && !parsed) {
      root.append(h('div', { class: 'callout callout-bad' }, icon('alert', 16), h('div', null, h('strong', null, 'The command failed.'), h('pre', { class: 'plain-pre' }, (data.stderr || data.stdout || 'No output was produced.').trim().slice(0, 4000)))));
    } else if (meta.status === 'cancelled') {
      root.append(h('div', { class: 'callout callout-warn' }, icon('stop', 16), h('span', null, 'This run was cancelled before it finished.')));
    }

    // ---- tabs ------------------------------------------------------------
    const hasEvidenceFile = (meta.artifacts || []).find((a) => a.kind === 'evidence');
    const tabs = [];
    if (parsed && !isErrorEnvelope) {
      tabs.push({ id: 'overview', label: 'Overview', ico: 'sparkles', render: () => overview(parsed, meta, data, hasEvidenceFile, goTree) });
      tabs.push({ id: 'explorer', label: 'Explorer', ico: 'tree', render: () => explorer(parsed) });
    } else if (data.truncated) {
      tabs.push({ id: 'overview', label: 'Overview', ico: 'sparkles', render: () => largeNotice(data, meta, hasEvidenceFile) });
    }
    tabs.push({ id: 'raw', label: 'Raw', ico: 'terminal', render: () => rawView(data, parsed, parseError) });
    const log = logLines(data.stderr);
    tabs.push({ id: 'log', label: log.noise ? 'Log •' : 'Log', ico: 'list', render: () => h('pre', { class: 'plain-pre card' }, log.text || 'No diagnostic output.') });

    const tabBar = h('div', { class: 'tabs', role: 'tablist' });
    const pane = h('div', { class: 'tab-pane' });
    let current = null;
    const cache = new Map();
    function select(tid) {
      current = tid;
      for (const b of tabBar.children) b.classList.toggle('active', b.dataset.tab === tid);
      pane.replaceChildren();
      if (!cache.has(tid)) cache.set(tid, tabs.find((t) => t.id === tid).render());
      pane.append(cache.get(tid));
    }
    for (const t of tabs) {
      const b = h('button', { class: 'tab', type: 'button', role: 'tab', dataset: { tab: t.id } }, icon(t.ico, 15), t.label);
      b.addEventListener('click', () => select(t.id));
      tabBar.append(b);
    }
    function goTree(path) {
      select('explorer');
      cache.get('explorer')?.__reveal?.(path);
    }
    root.append(tabBar, pane);
    select(tabs[0].id);
    void current;
  }

  await load();
  const off = on('runs', (m) => {
    if (m.id === id && m.final) load();
  });
  return {
    el: root,
    cleanup: () => {
      disposed = true;
      clearInterval(timer);
      off();
    },
  };
}

function stripAuto(meta) {
  const o = { ...meta.options };
  // Auto-provisioned evidence bundles are specific to the old run directory.
  if (o.evidence_output && (meta.artifacts || []).some((a) => a.path === o.evidence_output)) delete o.evidence_output;
  return o;
}

function errorPanel(err) {
  const issues = err.details?.issues || [];
  return h(
    'div',
    { class: 'card error-card' },
    h('div', { class: 'error-top' }, icon('alert', 20), h('div', null, h('h3', null, err.message), h('div', { class: 'chips' }, badge(err.code, 'bad'), err.category ? badge(err.category) : null, err.retryable ? badge('Retryable', 'warn') : null))),
    issues.length
      ? h('ul', { class: 'issue-list' }, issues.map((i) => h('li', null, h('code', null, (i.path || []).join('.') || 'input'), h('span', null, i.message || i.reason))))
      : null,
    err.remediation?.action ? h('div', { class: 'callout' }, icon('info', 16), h('span', null, err.remediation.action)) : null,
  );
}

function largeNotice(data, meta, evidenceFile) {
  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'callout callout-warn' },
      icon('alert', 16),
      h('div', null, h('strong', null, `This result is ${fmtBytes(data.size)}.`), h('p', null, 'It is too large to browse inline, so Reversey keeps it on disk. Re-run with a summary/filter, or export the full file.')),
    ),
    evidenceFile ? appExplorer(meta, evidenceFile) : null,
    h('div', { class: 'row-gap' }, btn('Export full result…', { ico: 'download', onClick: () => window.reversey.run.export(meta.id, 'json') }), btn('Show in folder', { ico: 'folder', onClick: () => window.reversey.run.reveal(meta.id) })),
  );
}

function explorer(parsed) {
  const wrap = h('div', { class: 'explorer' });
  const tree = createTree(parsed, { onCopy: (t, label) => copyText(t, label) });
  const input = h('input', { class: 'input search-input', placeholder: 'Search keys and values…', spellcheck: 'false', 'aria-label': 'Search result' });
  const results = h('div', { class: 'search-results', hidden: true });
  const info = h('span', { class: 'muted small' });

  const doSearch = debounce(() => {
    const q = input.value.trim();
    results.replaceChildren();
    results.hidden = !q;
    info.textContent = '';
    if (!q) return;
    const { results: hits, truncated } = searchJson(parsed, q);
    info.textContent = `${hits.length}${truncated ? '+' : ''} match${hits.length === 1 ? '' : 'es'}`;
    if (!hits.length) results.append(h('div', { class: 'search-none' }, 'No matches'));
    for (const hit of hits) {
      const row = h('button', { class: 'search-hit', type: 'button' }, badge(hit.kind, hit.kind === 'key' ? 'accent' : 'neutral'), h('code', { class: 'hit-path' }, pathToString(hit.path)), hit.kind === 'value' ? h('span', { class: 'hit-text' }, hit.text.slice(0, 120)) : null);
      row.addEventListener('click', () => tree.reveal(hit.path));
      results.append(row);
    }
  }, 180);
  input.addEventListener('input', doSearch);

  wrap.append(
    h('div', { class: 'toolbar' }, input, info, btn('Expand', { size: 'sm', onClick: () => tree.expandAll() }), btn('Collapse', { size: 'sm', onClick: () => tree.collapseAll() })),
    results,
    h('div', { class: 'card tree-card' }, tree.el),
  );
  wrap.__reveal = (path) => requestAnimationFrame(() => tree.reveal(path));
  return wrap;
}

function rawView(data, parsed, parseError) {
  let text = data.stdout || '';
  let note = null;
  if (data.truncated) note = `Showing the first 256 KB of ${fmtBytes(data.size)}.`;
  else if (parsed !== undefined) {
    const pretty = JSON.stringify(parsed, null, 2);
    if (pretty.length <= PRETTY_LIMIT) text = pretty;
    else note = 'Large result shown without pretty-printing.';
  } else if (parseError) note = 'Output is not JSON.';
  const pre = h('pre', { class: 'raw card' });
  if (text.length <= HIGHLIGHT_LIMIT && parsed !== undefined) pre.innerHTML = highlightJson(text);
  else pre.textContent = text.length > PRETTY_LIMIT ? `${text.slice(0, PRETTY_LIMIT)}\n… (truncated for display)` : text || 'No output.';
  return h('div', { class: 'stack' }, note ? h('div', { class: 'callout' }, icon('info', 16), h('span', null, note)) : null, h('div', { class: 'row-gap' }, btn('Copy', { size: 'sm', ico: 'copy', onClick: () => copyText(text) })), pre);
}
