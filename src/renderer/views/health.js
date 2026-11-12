import { h, icon } from '../lib/dom.js';
import { state, updateSettings } from '../lib/state.js';
import { btn, badge, copyText, toast, section } from '../lib/ui.js';

// Doctor check name -> env var that points REA at a caller-supplied engine.
const ENGINES = {
  hopper: { env: 'HOPPER_LAUNCHER_PATH', label: 'Hopper', kind: 'file', note: 'Launcher executable of a licensed Hopper installation.' },
  ghidra: { env: 'GHIDRA_INSTALL_DIR', label: 'Ghidra', kind: 'dir', note: 'Extracted Ghidra 12.1.x release folder.' },
  'ida-registration': { env: 'REA_IDA_MCP_CONFIG', label: 'IDA Pro', kind: 'file', note: 'Upstream IDA MCP registration JSON.' },
  jadx: { env: 'REA_JADX_MCP_JAR', label: 'JADX (Android)', kind: 'file', note: 'jadx-headless-mcp 0.7.1 JAR.' },
  'kuna-installation': { env: 'REA_KUNA_COMMAND', label: 'Kuna', kind: 'file', note: 'Absolute path to the kuna executable.' },
};

const GROUPS = [
  { id: 'runtime', title: 'Runtime', ico: 'cpu', test: (n) => /^(node|host|runtime|bun|npm)/.test(n) },
  { id: 'engines', title: 'Analysis engines', ico: 'binary', test: (n) => n in ENGINES || /(hopper|ghidra|ida|jadx|kuna|rizin|cutter|objdump|apktool|wabt|tshark|sigrok|frida|adb|pwn|gdb)/.test(n) },
  { id: 'agents', title: 'Agent integrations', ico: 'plug', test: (n) => /^(registration|skill)/.test(n) },
];

const tone = (c) => (c.ok ? 'good' : /missing_analysis_engine/.test(c.classification || '') ? 'neutral' : 'warn');

export async function healthView() {
  const body = h('div', { class: 'stack' }, h('div', { class: 'card live' }, h('div', { class: 'spinner' }), h('div', null, h('strong', null, 'Checking your setup…'), h('p', { class: 'muted' }, 'Running REA’s readiness diagnostics.'))));
  const recheck = btn('Re-check', { ico: 'refresh', onClick: () => load() });
  let alive = true;

  async function load() {
    recheck.disabled = true;
    body.replaceChildren(h('div', { class: 'card live' }, h('div', { class: 'spinner' }), h('div', null, h('strong', null, 'Checking your setup…'))));
    const [doc, prov] = await Promise.all([window.reversey.health.doctor(), window.reversey.health.providers()]);
    if (!alive) return;
    recheck.disabled = false;
    body.replaceChildren(...render(doc, prov));
  }

  function render(doc, prov) {
    const out = [];
    const data = doc.json;
    if (!data || !Array.isArray(data.scope_checks)) {
      out.push(h('div', { class: 'callout callout-bad' }, icon('alert', 16), h('div', null, h('strong', null, 'Could not read the diagnostics.'), h('pre', { class: 'plain-pre' }, (doc.stderr || doc.stdout || '').slice(0, 1500)))));
      return out;
    }
    const checks = data.scope_checks;
    const engines = checks.filter((c) => c.name in ENGINES);
    const ready = engines.filter((c) => c.ok).length;
    const runtimeOk = checks.filter((c) => GROUPS[0].test(c.name)).every((c) => c.ok);

    out.push(
      h(
        'div',
        { class: `card hero-status ${runtimeOk ? 'ok' : 'warn'}` },
        h('div', { class: 'hs-ico' }, icon(runtimeOk ? 'shield' : 'alert', 26)),
        h(
          'div',
          null,
          h('h2', null, runtimeOk ? 'Static analysis is ready' : 'Runtime needs attention'),
          h('p', null, runtimeOk ? `JavaScript, .NET, PE/ELF, Android packages, captures and more work out of the box. ${ready ? `${ready} deep-analysis engine${ready > 1 ? 's' : ''} detected.` : 'Add a disassembler engine below to unlock deep native decompilation.'}` : 'Some runtime checks failed. See details below.'),
        ),
      ),
    );

    for (const g of GROUPS) {
      const list = checks.filter((c) => (g.id === 'engines' ? GROUPS[1].test(c.name) : g.id === 'runtime' ? g.test(c.name) : g.test(c.name)));
      if (!list.length) continue;
      if (g.id === 'agents') continue; // handled by a dedicated section
      out.push(section(g.title, h('div', { class: 'card check-card' }, list.map((c) => checkRow(c, load)))));
    }

    // Agent integrations: informational, setup happens through the CLI.
    const agentChecks = checks.filter((c) => GROUPS[2].test(c.name));
    if (agentChecks.length) {
      const configured = agentChecks.filter((c) => c.ok);
      out.push(
        section(
          'AI agent integrations',
          h(
            'div',
            { class: 'card' },
            h('p', { class: 'muted' }, 'REA can also run as an MCP server so an AI agent (Claude Code, Codex, Cursor, Gemini…) can use the same tools. Registration is done with REA’s own setup command, which shows its plan and asks for approval.'),
            h('div', { class: 'code-block' }, h('code', null, 'npx rea-agents setup'), btn('', { size: 'sm', ico: 'copy', title: 'Copy', onClick: () => copyText('npx rea-agents setup', 'Command copied') })),
            h('div', { class: 'chips wrap' }, agentChecks.map((c) => badge(c.name.replace(/^registration:/, '').replace(/^skill:/, 'skill · '), c.ok ? 'good' : 'neutral', c.ok ? 'check' : undefined))),
            h('p', { class: 'muted small' }, configured.length ? `${configured.length} integration${configured.length > 1 ? 's' : ''} up to date.` : 'No agent is registered yet — that is fine if you only use Reversey.'),
          ),
        ),
      );
    }

    // Provider capabilities
    const caps = prov.json?.capabilities;
    if (Array.isArray(caps) && caps.length) {
      out.push(
        section(
          'Provider capabilities',
          h(
            'div',
            { class: 'card provider-grid' },
            caps.map((c) => {
              const groups = c.groups || [];
              const avail = groups.filter((g) => g.available).length;
              const pct = groups.length ? Math.round((avail / groups.length) * 100) : 0;
              const reason = groups.find((g) => !g.available)?.reason;
              return h(
                'div',
                { class: 'provider' },
                h('div', { class: 'provider-top' }, h('strong', null, c.provider?.name || c.provider?.id), badge(`${avail}/${groups.length}`, avail === groups.length ? 'good' : avail ? 'info' : 'neutral')),
                h('div', { class: 'meter' }, h('span', { style: { width: `${pct}%` } })),
                reason && avail < groups.length ? h('small', { class: 'muted' }, reason) : h('small', { class: 'muted' }, 'All operation groups available'),
              );
            }),
          ),
        ),
      );
    }
    return out;
  }

  await load();
  const el = h('div', { class: 'page' }, h('div', { class: 'page-head row' }, h('div', null, h('h1', null, 'Health'), h('p', { class: 'lede' }, 'See what REA can do on this machine, and point it at the engines you own.')), recheck), body);
  return { el, cleanup: () => (alive = false) };
}

function checkRow(c, reload) {
  const eng = ENGINES[c.name];
  const configured = eng && state.settings.env?.[eng.env];
  const row = h(
    'div',
    { class: 'check-row' },
    h('span', { class: `check-ico ${tone(c)}` }, icon(c.ok ? 'check' : /missing_analysis_engine/.test(c.classification || '') ? 'dots' : 'alert', 14)),
    h(
      'div',
      { class: 'check-main' },
      h('div', { class: 'check-title' }, h('strong', null, eng?.label || c.name), c.ok ? badge('Ready', 'good') : badge(c.classification ? c.classification.replace(/_/g, ' ') : 'Not ready', tone(c))),
      c.detail && c.ok ? h('small', { class: 'muted mono' }, c.detail) : null,
      !c.ok && c.remediation ? h('small', { class: 'muted' }, c.remediation) : null,
      configured ? h('small', { class: 'muted mono' }, `${eng.env} = ${configured}`) : null,
    ),
  );
  if (eng) {
    const set = btn(configured ? 'Change…' : 'Locate…', {
      size: 'sm',
      ico: eng.kind === 'dir' ? 'folder' : 'file',
      onClick: async () => {
        const [p] = await window.reversey.dialog.open({ kind: eng.kind === 'dir' ? 'dir' : 'file', title: `Locate ${eng.label}` });
        if (!p) return;
        await updateSettings({ env: { ...state.settings.env, [eng.env]: p } });
        toast(`${eng.label} path saved`, 'good');
        reload();
      },
    });
    const actions = h('div', { class: 'row-gap' }, set);
    if (configured)
      actions.append(
        btn('', {
          size: 'sm',
          ico: 'x',
          title: 'Clear path',
          onClick: async () => {
            const env = { ...state.settings.env };
            delete env[eng.env];
            await updateSettings({ env });
            reload();
          },
        }),
      );
    row.append(actions);
    row.title = eng.note;
  }
  return row;
}
