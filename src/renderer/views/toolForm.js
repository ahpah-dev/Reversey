import { h, icon } from '../lib/dom.js';
import { state, startRun, updateSettings } from '../lib/state.js';
import { btn, riskBadge, badge, copyText, empty, toast } from '../lib/ui.js';
import { claimDrops } from '../lib/nav.js';

const VISIBLE_OPTIONS = 6;
const quote = (s) => (/[\s"'&|<>^]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : s);

// Decide how to edit a field based on its schema.
function widgetFor(f) {
  const d = (f.description || '').toLowerCase();
  const k = f.key;
  if (f.type === 'boolean') return 'bool';
  if (f.type === 'array') return 'lines';
  if (f.enum) return 'select';
  if (f.type === 'integer' || f.type === 'number') return 'number';
  if (/json$/i.test(k) || /^(input|beforeJson|afterJson)$/.test(k) || /inline (workflow )?json|json file path|json (array|object)/.test(d)) return 'json';
  if (f.type === 'string' && !/device|relative to/.test(d)) {
    const dirKey = /(directory|folder|^root$)/i.test(k) || /(absent|output|destination) (directory|folder)|\bdirectory\b/.test(d);
    if (dirKey) return 'dir';
    const pathKey = /(path|file|manifest|capture|archive|script|source|snapshot|bundle|config|jar|launcher)$/i.test(k) || /^(manifest|capture|archive|source|path|input)$/i.test(k);
    const pathDesc = /\b(local|selected|source|saved|existing|retained)?\s*(path|file)\b/.test(d) && !/device|inline|url|origin/.test(d);
    if (pathKey || pathDesc) return /output|evidence_output/.test(k) ? 'savefile' : 'path';
  }
  return 'text';
}

export async function toolFormView({ params }) {
  const cmd = state.byName.get(params[0]);
  if (!cmd) return { el: h('div', { class: 'page' }, empty('search', 'Unknown tool', `There is no tool named “${params[0]}”.`, btn('Browse tools', { variant: 'primary', onClick: () => (location.hash = '#/tools') }))) };

  const pre = state.prefill && state.prefill.command === cmd.name ? state.prefill : null;
  state.prefill = null;
  const values = { args: { ...(pre?.args || {}) }, options: { ...(pre?.options || {}) }, global: { ...(pre?.global || {}) } };
  const targetPath = pre?.targetPath || null;
  const catInfo = state.catalog.categories.find((c) => c.id === cmd.category);
  const isFav = () => (state.settings.favorites || []).includes(cmd.name);

  const previewCode = h('code', { class: 'cli-code' });
  const runBtn = btn('Run', { variant: 'primary', ico: 'play' });
  const hint = h('span', { class: 'form-hint' });

  // ---- argv preview + validation -------------------------------------------
  function argvPreview() {
    const parts = ['rea', cmd.name];
    for (const a of cmd.args) {
      const v = values.args[a.key];
      parts.push(v ? quote(v) : `<${a.key}>`);
    }
    for (const o of cmd.options) {
      const v = values.options[o.key];
      if (v === undefined || v === '' || v === null) continue;
      if (o.type === 'boolean') {
        if (v === true) parts.push(`--${o.flag}`);
        else if (o.default === true) parts.push(`--no-${o.flag}`);
      } else if (o.type === 'array') {
        for (const line of String(Array.isArray(v) ? v.join('\n') : v).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) parts.push(`--${o.flag}`, quote(line));
      } else parts.push(`--${o.flag}`, quote(v));
    }
    if (values.global.filterOutput) parts.push('--filter-output', quote(values.global.filterOutput));
    if (values.global.tokenLimit) parts.push('--token-limit', values.global.tokenLimit);
    parts.push('--format', 'json');
    return parts.join(' ');
  }

  function missing() {
    const out = [];
    for (const a of cmd.args) if (a.required && !values.args[a.key]) out.push(a.key);
    for (const o of cmd.options) if (o.required && (values.options[o.key] === undefined || values.options[o.key] === '')) out.push(o.key);
    return out;
  }

  function refresh() {
    previewCode.textContent = argvPreview();
    const m = missing();
    runBtn.disabled = m.length > 0;
    hint.textContent = m.length ? `Required: ${m.join(', ')}` : '';
  }

  // ---- field builders ------------------------------------------------------
  function field(f, bucket) {
    const store = values[bucket];
    const widget = widgetFor(f);
    const id = `f-${bucket}-${f.key}`;
    const set = (v) => {
      if (v === '' || v === undefined || (Array.isArray(v) && !v.length)) delete store[f.key];
      else store[f.key] = v;
      refresh();
    };
    const label = h('label', { class: 'field-label', for: id }, f.key, f.required ? h('span', { class: 'req', title: 'Required' }, '*') : null, h('code', { class: 'flag' }, bucket === 'args' ? 'argument' : `--${f.flag}`));
    let control;

    if (widget === 'bool') {
      const cb = h('input', { type: 'checkbox', id, role: 'switch' });
      cb.checked = store[f.key] === true || (store[f.key] === undefined && f.default === true);
      if (f.default === true && store[f.key] === undefined) store[f.key] = true;
      cb.addEventListener('change', () => {
        store[f.key] = cb.checked;
        refresh();
      });
      control = h('label', { class: 'switch' }, cb, h('span', { class: 'switch-track' }, h('span', { class: 'switch-thumb' })), h('span', { class: 'switch-text' }, f.default === true ? 'Enabled by default' : 'Off by default'));
    } else if (widget === 'select') {
      const sel = h('select', { class: 'input', id }, h('option', { value: '' }, f.default !== undefined ? `Default (${f.default})` : f.required ? 'Choose…' : 'Default'), f.enum.map((v) => h('option', { value: v }, v)));
      sel.value = store[f.key] ?? '';
      sel.addEventListener('change', () => set(sel.value));
      control = sel;
    } else if (widget === 'number') {
      const inp = h('input', { class: 'input', id, type: 'number', step: f.type === 'integer' ? '1' : 'any', min: f.min, max: f.max, placeholder: f.default !== undefined ? `Default ${f.default}` : f.min !== undefined && f.max !== undefined ? `${f.min} – ${f.max}` : '' });
      if (store[f.key] !== undefined) inp.value = store[f.key];
      inp.addEventListener('input', () => set(inp.value));
      control = inp;
    } else if (widget === 'lines') {
      const ta = h('textarea', { class: 'input textarea', id, rows: '3', placeholder: 'One value per line', spellcheck: 'false' });
      if (store[f.key]) ta.value = Array.isArray(store[f.key]) ? store[f.key].join('\n') : store[f.key];
      ta.addEventListener('input', () => set(ta.value.trim() ? ta.value : ''));
      control = ta;
    } else if (widget === 'json') {
      const ta = h('textarea', { class: 'input textarea mono', id, rows: '5', placeholder: '{ … }  or the path to a .json file', spellcheck: 'false' });
      const state_ = h('span', { class: 'json-state' });
      const check = () => {
        const t = ta.value.trim();
        state_.className = 'json-state';
        state_.textContent = '';
        if (!t) return;
        if (/^[{["]/.test(t) || /^(true|false|null|-?\d)/.test(t)) {
          try {
            JSON.parse(t);
            state_.classList.add('ok');
            state_.textContent = 'Valid JSON';
          } catch (e) {
            state_.classList.add('bad');
            state_.textContent = e.message;
          }
        } else {
          state_.textContent = 'Treated as a file path';
        }
      };
      if (store[f.key]) ta.value = store[f.key];
      ta.addEventListener('input', () => {
        set(ta.value.trim());
        check();
      });
      check();
      const pick = btn('Choose .json…', {
        size: 'sm',
        ico: 'file',
        onClick: async () => {
          const [p] = await window.reversey.dialog.open({ kind: 'file', filters: [{ name: 'JSON', extensions: ['json'] }] });
          if (p) {
            ta.value = p;
            set(p);
            check();
          }
        },
      });
      claimDrops(ta, ([p]) => {
        ta.value = p;
        set(p);
        check();
      });
      control = h('div', { class: 'json-field' }, ta, h('div', { class: 'json-foot' }, pick, state_));
    } else if (widget === 'path' || widget === 'dir' || widget === 'savefile') {
      const inp = h('input', { class: 'input mono', id, type: 'text', placeholder: widget === 'dir' ? 'Folder path' : widget === 'savefile' ? 'Where to save (must not exist)' : 'File or folder path', spellcheck: 'false' });
      if (store[f.key]) inp.value = store[f.key];
      inp.addEventListener('input', () => set(inp.value.trim()));
      const setPath = (p) => {
        inp.value = p;
        set(p);
      };
      claimDrops(inp, ([p]) => setPath(p));
      const buttons = [];
      if (widget !== 'dir' && widget !== 'savefile') buttons.push(btn('', { ico: 'file', title: 'Choose file…', onClick: async () => { const [p] = await window.reversey.dialog.open({ kind: 'file' }); if (p) setPath(p); } }));
      if (widget !== 'savefile') buttons.push(btn('', { ico: 'folder', title: 'Choose folder…', onClick: async () => { const [p] = await window.reversey.dialog.open({ kind: 'dir', create: widget === 'dir' }); if (p) setPath(p); } }));
      if (widget === 'savefile') buttons.push(btn('', { ico: 'download', title: 'Choose destination…', onClick: async () => { const p = await window.reversey.dialog.save({ title: 'Choose destination' }); if (p) setPath(p); } }));
      control = h('div', { class: 'input-group' }, inp, buttons);
    } else {
      const listId = f.suggestions ? `dl-${bucket}-${f.key}` : null;
      const inp = h('input', { class: 'input', id, type: 'text', list: listId, placeholder: f.default !== undefined ? `Default ${f.default}` : f.pattern ? '' : '', spellcheck: 'false' });
      if (store[f.key]) inp.value = store[f.key];
      inp.addEventListener('input', () => set(inp.value.trim()));
      control = [inp, listId ? h('datalist', { id: listId }, f.suggestions.map((s) => h('option', { value: s }))) : null];
    }
    return h('div', { class: 'field' }, label, control, f.description ? h('p', { class: 'field-help' }, f.description) : null);
  }

  const inputsSection = cmd.args.length
    ? h('section', { class: 'card form-card' }, h('h3', null, 'Inputs'), cmd.args.map((a) => field(a, 'args')))
    : null;

  const requiredOpts = cmd.options.filter((o) => o.required);
  const restOpts = cmd.options.filter((o) => !o.required);
  const shown = [...requiredOpts, ...restOpts.slice(0, Math.max(0, VISIBLE_OPTIONS - requiredOpts.length))];
  const advanced = restOpts.slice(Math.max(0, VISIBLE_OPTIONS - requiredOpts.length));

  const optionsSection = shown.length ? h('section', { class: 'card form-card' }, h('h3', null, 'Options'), shown.map((o) => field(o, 'options'))) : null;

  const details = (title, body, open = false) => {
    const d = h('details', { class: 'card form-card details' }, h('summary', null, icon('chevron', 14, 'sum-caret'), title), h('div', { class: 'details-body' }, body));
    if (open) d.open = true;
    return d;
  };
  const advSection = advanced.length ? details(`Advanced options (${advanced.length})`, advanced.map((o) => field(o, 'options')), advanced.some((o) => values.options[o.key] !== undefined)) : null;

  const outputSection = details('Output shaping', [
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'field-label', for: 'g-filter' }, 'Filter output keys', h('code', { class: 'flag' }, '--filter-output')),
      (() => {
        const i = h('input', { class: 'input mono', id: 'g-filter', placeholder: 'e.g. normalized_result.modules[0,10]', spellcheck: 'false', value: values.global.filterOutput || '' });
        i.addEventListener('input', () => {
          values.global.filterOutput = i.value.trim() || undefined;
          refresh();
        });
        return i;
      })(),
      h('p', { class: 'field-help' }, 'Keep only the key paths you care about. Great for large results.'),
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'field-label', for: 'g-tok' }, 'Token limit', h('code', { class: 'flag' }, '--token-limit')),
      (() => {
        const i = h('input', { class: 'input', id: 'g-tok', type: 'number', min: '1', placeholder: 'Unlimited', value: values.global.tokenLimit || '' });
        i.addEventListener('input', () => {
          values.global.tokenLimit = i.value || undefined;
          refresh();
        });
        return i;
      })(),
      h('p', { class: 'field-help' }, 'Truncate the result to roughly this many tokens.'),
    ),
  ], !!(values.global.filterOutput || values.global.tokenLimit));

  const favBtn = h('button', { class: `star star-lg ${isFav() ? 'on' : ''}`, type: 'button', title: 'Favorite', 'aria-label': 'Toggle favorite' }, icon('star', 18));
  favBtn.addEventListener('click', async () => {
    const set = new Set(state.settings.favorites || []);
    set.has(cmd.name) ? set.delete(cmd.name) : set.add(cmd.name);
    await updateSettings({ favorites: [...set] });
    favBtn.classList.toggle('on', isFav());
  });

  runBtn.addEventListener('click', async () => {
    const id = await startRun(cmd.name, values.args, values.options, { global: values.global, targetPath: targetPath || guessTarget(), title: cmd.description });
    void id;
  });

  function guessTarget() {
    const first = cmd.args[0];
    const v = first && values.args[first.key];
    return typeof v === 'string' && /^([a-zA-Z]:[\\/]|[\\/])/.test(v) ? v : null;
  }

  const bar = h(
    'div',
    { class: 'run-bar' },
    h('div', { class: 'cli-preview' }, icon('terminal', 15), previewCode),
    hint,
    btn('Copy CLI', { ico: 'copy', onClick: () => copyText(previewCode.textContent, 'Command copied') }),
    runBtn,
  );

  refresh();
  const el = h(
    'div',
    { class: 'page page-form' },
    h('div', { class: 'crumbs' }, h('a', { class: 'crumb', href: '#/tools' }, icon('chevron', 14, 'flip'), 'Tools'), catInfo ? h('span', { class: 'muted small' }, catInfo.name) : null),
    h(
      'div',
      { class: 'form-head' },
      h('div', null, h('h1', { class: 'mono-title' }, cmd.name), h('p', { class: 'lede' }, cmd.description)),
      h('div', { class: 'form-head-actions' }, riskBadge(cmd.risk), favBtn),
    ),
    cmd.risk === 'execute'
      ? h('div', { class: 'callout callout-warn' }, icon('bolt', 16), h('span', null, 'This tool launches or attaches to a process. Reversey will ask for confirmation before running it.'))
      : cmd.risk === 'device'
        ? h('div', { class: 'callout callout-bad' }, icon('smartphone', 16), h('span', null, 'This tool changes the connected device. Reversey will ask for confirmation before running it.'))
        : null,
    inputsSection,
    optionsSection,
    advSection,
    outputSection,
    h('div', { class: 'bar-spacer' }),
    bar,
  );
  void badge;
  void toast;
  return { el };
}
