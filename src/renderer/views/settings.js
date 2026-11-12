import { h, icon } from '../lib/dom.js';
import { state, updateSettings } from '../lib/state.js';
import { btn, confirmDialog, toast, kbd, section } from '../lib/ui.js';

const ACCENTS = [
  ['violet', '#8b7cff'],
  ['cyan', '#2fc4e6'],
  ['emerald', '#34d399'],
  ['amber', '#f5b44a'],
  ['rose', '#fb7185'],
];

function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup' });
  const draw = (cur) => {
    wrap.replaceChildren(
      ...options.map(([id, label, ico]) => {
        const b = h('button', { class: `seg ${cur === id ? 'active' : ''}`, type: 'button', role: 'radio', 'aria-checked': cur === id ? 'true' : 'false' }, ico ? icon(ico, 14) : null, label);
        b.addEventListener('click', () => {
          onChange(id);
          draw(id);
        });
        return b;
      }),
    );
  };
  draw(value);
  return wrap;
}

const row = (label, help, control) => h('div', { class: 'setting-row' }, h('div', { class: 'setting-text' }, h('strong', null, label), help ? h('small', null, help) : null), h('div', { class: 'setting-control' }, control));

export async function settingsView() {
  const s = state.settings;

  const accentSwatches = h('div', { class: 'swatches' });
  const drawSwatches = (cur) => {
    accentSwatches.replaceChildren(
      ...ACCENTS.map(([id, color]) => {
        const b = h('button', { class: `swatch ${cur === id ? 'active' : ''}`, type: 'button', title: id, 'aria-label': `${id} accent`, style: { '--c': color } }, cur === id ? icon('check', 14) : null);
        b.addEventListener('click', () => {
          updateSettings({ accent: id });
          drawSwatches(id);
        });
        return b;
      }),
    );
  };
  drawSwatches(s.accent);

  // custom environment variables
  const envList = h('div', { class: 'env-list' });
  const drawEnv = () => {
    envList.replaceChildren();
    const items = state.settings.extraEnv || [];
    items.forEach((it, i) => {
      const k = h('input', { class: 'input mono', value: it.key, placeholder: 'NAME', spellcheck: 'false', 'aria-label': 'Variable name' });
      const v = h('input', { class: 'input mono', value: it.value, placeholder: 'value', spellcheck: 'false', 'aria-label': 'Variable value' });
      const save = () => {
        const next = [...(state.settings.extraEnv || [])];
        next[i] = { key: k.value.trim(), value: v.value };
        updateSettings({ extraEnv: next });
      };
      k.addEventListener('change', save);
      v.addEventListener('change', save);
      envList.append(
        h('div', { class: 'env-row' }, k, v, btn('', { size: 'sm', ico: 'trash', title: 'Remove', onClick: () => {
          const next = (state.settings.extraEnv || []).filter((_, j) => j !== i);
          updateSettings({ extraEnv: next }).then(drawEnv);
        } })),
      );
    });
    if (!items.length) envList.append(h('p', { class: 'muted small' }, 'No custom variables. Engine paths set on the Health page are applied automatically.'));
  };
  drawEnv();

  const engineEnv = Object.entries(s.env || {}).filter(([, v]) => v);

  const el = h(
    'div',
    { class: 'page page-narrow' },
    h('div', { class: 'page-head' }, h('h1', null, 'Settings')),
    section(
      'Appearance',
      h(
        'div',
        { class: 'card settings-card' },
        row('Theme', 'Follow the system or choose one.', segmented([['dark', 'Dark', 'moon'], ['light', 'Light', 'sun'], ['system', 'System']], s.theme, (v) => updateSettings({ theme: v }))),
        row('Accent color', null, accentSwatches),
        row('Density', 'Compact fits more on screen.', segmented([['comfortable', 'Comfortable'], ['compact', 'Compact']], s.density, (v) => updateSettings({ density: v }))),
      ),
    ),
    section(
      'Environment',
      h(
        'div',
        { class: 'card settings-card' },
        h('p', { class: 'muted small' }, 'These variables are passed to every REA process. Use them for tool locations such as ', h('code', null, 'GHIDRA_INSTALL_DIR'), ' or ', h('code', null, 'REA_JADX_MCP_JAR'), '.'),
        engineEnv.length ? h('div', { class: 'chips wrap' }, engineEnv.map(([k]) => h('span', { class: 'badge badge-good' }, icon('check', 12), k))) : null,
        envList,
        btn('Add variable', { size: 'sm', ico: 'play', onClick: () => updateSettings({ extraEnv: [...(state.settings.extraEnv || []), { key: '', value: '' }] }).then(drawEnv) }),
        h('div', { class: 'row-gap' }, btn('Open Health…', { size: 'sm', ico: 'heart', onClick: () => (location.hash = '#/health') })),
      ),
    ),
    section(
      'Data & privacy',
      h(
        'div',
        { class: 'card settings-card' },
        row('Local data', state.info.userData, btn('Open folder', { size: 'sm', ico: 'folder', onClick: () => window.reversey.shell.openDataDir() })),
        row('Saved runs', 'Delete every saved result and log.', btn('Clear history', { size: 'sm', ico: 'trash', onClick: async () => {
          if (await confirmDialog({ title: 'Clear all runs?', message: 'All saved results and logs will be deleted from disk.', confirmLabel: 'Clear', tone: 'danger' })) {
            await window.reversey.run.clear();
            for (const r of [...state.runs.values()]) if (r.status !== 'running') state.runs.delete(r.id);
            toast('History cleared', 'good');
          }
        } })),
        row('Responsible-use notice', 'Show the first-run acknowledgement again on next launch.', btn('Reset', { size: 'sm', onClick: async () => { await updateSettings({ consentVersion: 0 }); toast('It will appear on next launch', 'info'); } })),
        h('p', { class: 'muted small' }, 'Reversey never uploads targets or results. All analysis happens on this computer.'),
      ),
    ),
    section(
      'Keyboard shortcuts',
      h(
        'div',
        { class: 'card settings-card shortcuts' },
        [
          ['Command palette', ['Ctrl', 'K']],
          ['Open file or folder', ['Ctrl', 'O']],
          ['Analyze · Tools · Workspace · Health', ['Ctrl', '1–4']],
          ['Close dialog or palette', ['Esc']],
        ].map(([label, keys]) => h('div', { class: 'shortcut' }, h('span', null, label), h('span', { class: 'kbds' }, keys.map(kbd)))),
      ),
    ),
  );
  return { el };
}
