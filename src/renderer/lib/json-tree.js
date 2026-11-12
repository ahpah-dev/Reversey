// Lazy, searchable JSON tree. Children are only built when a node is expanded,
// and large collections are paged so multi-megabyte results stay responsive.
import { h, icon } from './dom.js';

const PAGE = 100;
const MAX_STR = 240;

export const isContainer = (v) => v !== null && typeof v === 'object';

export function pathToString(path) {
  let s = '$';
  for (const p of path) s += typeof p === 'number' ? `[${p}]` : /^[A-Za-z_][\w]*$/.test(p) ? `.${p}` : `["${p}"]`;
  return s;
}

const previewOf = (v) => {
  if (Array.isArray(v)) return `[${v.length}]`;
  const keys = Object.keys(v);
  return `{${keys.length}}`;
};

const shortPreview = (v) => {
  if (!isContainer(v)) return '';
  const keys = Array.isArray(v) ? [] : Object.keys(v).slice(0, 4);
  if (Array.isArray(v)) {
    const first = v[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) return ` · ${Object.keys(first).slice(0, 3).join(', ')}…`;
    return v.length ? ` · ${v.slice(0, 3).map((x) => (typeof x === 'string' ? `"${x.slice(0, 18)}"` : String(x).slice(0, 18))).join(', ')}${v.length > 3 ? '…' : ''}` : '';
  }
  return keys.length ? ` · ${keys.join(', ')}${Object.keys(v).length > 4 ? '…' : ''}` : '';
};

export function createTree(data, { onCopy } = {}) {
  const el = h('div', { class: 'jt', role: 'tree' });
  const registry = new Map(); // path string -> node controller

  function valueSpan(v) {
    if (v === null) return h('span', { class: 'jt-null' }, 'null');
    switch (typeof v) {
      case 'string': {
        if (v.length <= MAX_STR) return h('span', { class: 'jt-str' }, JSON.stringify(v));
        const span = h('span', { class: 'jt-str' });
        const shown = h('span', null, JSON.stringify(v.slice(0, MAX_STR)).slice(0, -1) + '…"');
        const more = h('button', { class: 'jt-more', type: 'button' }, `show all ${v.length.toLocaleString()} chars`);
        more.addEventListener('click', (e) => {
          e.stopPropagation();
          shown.textContent = JSON.stringify(v);
          more.remove();
        });
        span.append(shown, ' ', more);
        return span;
      }
      case 'number':
        return h('span', { class: 'jt-num' }, String(v));
      case 'boolean':
        return h('span', { class: 'jt-bool' }, String(v));
      default:
        return h('span', null, String(v));
    }
  }

  function entry(key, value, path) {
    const container = isContainer(value);
    const pstr = pathToString(path);
    const keyLabel =
      key === null ? null : typeof key === 'number' ? h('span', { class: 'jt-idx' }, key) : h('span', { class: 'jt-key' }, key);
    const caret = container ? h('span', { class: 'jt-caret' }, icon('chevron', 12)) : h('span', { class: 'jt-caret jt-caret-empty' });
    const actions = h(
      'span',
      { class: 'jt-actions' },
      h('button', { class: 'jt-act', type: 'button', title: 'Copy path', onClick: (e) => { e.stopPropagation(); onCopy?.(pstr, 'Path copied'); } }, icon('link', 12)),
      h(
        'button',
        {
          class: 'jt-act',
          type: 'button',
          title: 'Copy value',
          onClick: (e) => {
            e.stopPropagation();
            onCopy?.(typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'Value copied');
          },
        },
        icon('copy', 12),
      ),
    );
    const row = h('div', { class: 'jt-row', role: 'treeitem' }, caret, keyLabel, keyLabel ? h('span', { class: 'jt-colon' }, ':') : null);
    if (container) {
      row.append(h('span', { class: 'jt-meta' }, previewOf(value)), h('span', { class: 'jt-peek' }, shortPreview(value)));
    } else row.append(valueSpan(value));
    row.append(actions);

    const wrap = h('div', { class: 'jt-n' }, row);
    const ctl = { wrap, row, path, container, expanded: false, built: false, kids: null, value };
    registry.set(pstr, ctl);

    if (container) {
      const kids = h('div', { class: 'jt-kids' });
      ctl.kids = kids;
      wrap.append(kids);
      ctl.expand = () => {
        if (!ctl.built) {
          buildChildren(ctl, 0);
          ctl.built = true;
        }
        ctl.expanded = true;
        wrap.classList.add('open');
      };
      ctl.collapse = () => {
        ctl.expanded = false;
        wrap.classList.remove('open');
      };
      row.addEventListener('click', () => (ctl.expanded ? ctl.collapse() : ctl.expand()));
    }
    return ctl;
  }

  function buildChildren(ctl, from) {
    const { value, path, kids } = ctl;
    const isArr = Array.isArray(value);
    const keys = isArr ? null : Object.keys(value);
    const total = isArr ? value.length : keys.length;
    const to = Math.min(total, from + PAGE);
    const moreRow = kids.querySelector(':scope > .jt-pager');
    if (moreRow) moreRow.remove();
    for (let i = from; i < to; i++) {
      const k = isArr ? i : keys[i];
      kids.append(entry(k, value[k], [...path, k]).wrap);
    }
    ctl.shown = to;
    if (to < total) {
      const next = Math.min(PAGE, total - to);
      const pager = h(
        'button',
        { class: 'jt-pager', type: 'button' },
        `Show ${next} more`,
        h('span', { class: 'jt-pager-rest' }, ` · ${(total - to).toLocaleString()} remaining`),
      );
      pager.addEventListener('click', () => buildChildren(ctl, to));
      kids.append(pager);
    }
  }

  const rootCtl = entry(null, data, []);
  el.append(rootCtl.wrap);
  rootCtl.expand?.();

  function revealPath(path) {
    // Expand each ancestor, paging in array/object chunks until the target exists.
    let ctl = rootCtl;
    for (let depth = 0; depth < path.length; depth++) {
      if (!ctl.container) break;
      ctl.expand();
      const key = path[depth];
      const keys = Array.isArray(ctl.value) ? null : Object.keys(ctl.value);
      const index = keys ? keys.indexOf(key) : key;
      while (ctl.shown <= index) buildChildren(ctl, ctl.shown);
      const next = registry.get(pathToString(path.slice(0, depth + 1)));
      if (!next) return null;
      ctl = next;
    }
    ctl.row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    ctl.row.classList.add('flash');
    setTimeout(() => ctl.row.classList.remove('flash'), 1400);
    return ctl;
  }

  function setAll(open, maxDepth = 3) {
    const walk = (ctl, depth) => {
      if (!ctl.container) return;
      if (open) {
        if (depth >= maxDepth) return;
        ctl.expand();
        for (const c of ctl.kids.querySelectorAll(':scope > .jt-n')) {
          // children registered by path; look them up via the DOM order
          void c;
        }
        const keys = Array.isArray(ctl.value) ? [...ctl.value.keys()] : Object.keys(ctl.value);
        for (let i = 0; i < Math.min(keys.length, ctl.shown || 0); i++) {
          const child = registry.get(pathToString([...ctl.path, keys[i]]));
          if (child) walk(child, depth + 1);
        }
      } else {
        ctl.collapse?.();
      }
    };
    if (open) walk(rootCtl, 0);
    else {
      for (const ctl of registry.values()) ctl.collapse?.();
      rootCtl.expand();
    }
  }

  return {
    el,
    reveal: revealPath,
    expandAll: () => setAll(true, 4),
    collapseAll: () => setAll(false),
  };
}

// Breadth-limited search over keys and primitive values.
export function searchJson(data, term, { limit = 200, budget = 600000 } = {}) {
  const q = term.toLowerCase();
  const results = [];
  let visited = 0;
  const stack = [[data, []]];
  while (stack.length && results.length < limit && visited < budget) {
    const [node, path] = stack.pop();
    visited++;
    if (isContainer(node)) {
      const entries = Array.isArray(node) ? node.map((v, i) => [i, v]) : Object.entries(node);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [k, v] = entries[i];
        if (typeof k === 'string' && k.toLowerCase().includes(q)) results.push({ path: [...path, k], kind: 'key', text: k });
        if (isContainer(v)) stack.push([v, [...path, k]]);
        else if (v !== null && String(v).toLowerCase().includes(q)) results.push({ path: [...path, k], kind: 'value', text: String(v) });
        if (results.length >= limit) break;
      }
    }
  }
  return { results, truncated: results.length >= limit || visited >= budget };
}

export function summarizeShape(data) {
  if (!isContainer(data)) return [];
  const entries = Array.isArray(data) ? data.slice(0, 50).map((v, i) => [i, v]) : Object.entries(data);
  return entries.map(([k, v]) => ({
    key: k,
    type: v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v,
    size: Array.isArray(v) ? v.length : isContainer(v) ? Object.keys(v).length : null,
    sample: !isContainer(v) ? String(v).slice(0, 80) : '',
  }));
}
