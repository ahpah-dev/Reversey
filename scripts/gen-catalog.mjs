// Generates src/main/catalog.json from the installed rea-agents CLI manifest.
// Run with: npm run catalog
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronBin = require('electron');
const reaEntry = join(root, 'node_modules', 'rea-agents', 'scripts', 'rea.mjs');
const reaPkg = require(join(root, 'node_modules', 'rea-agents', 'package.json'));

const run = spawnSync(electronBin, [reaEntry, '--llms-full', '--format', 'json'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (run.status !== 0) {
  console.error(run.stderr);
  process.exit(run.status || 1);
}
const manifest = JSON.parse(run.stdout);

// ---- categorisation -------------------------------------------------------
const CATEGORIES = [
  { id: 'native', name: 'Native code', icon: 'cpu', blurb: 'Decompile, disassemble, search and trace native binaries.' },
  { id: 'binary', name: 'Binary formats', icon: 'binary', blurb: 'Static inspectors for PE, ELF, Go, Rust, WASM, models, SQLite and more.' },
  { id: 'javascript', name: 'JavaScript & Electron', icon: 'braces', blurb: 'Reconstruct JS / Electron apps, recover sources, trace features.' },
  { id: 'web', name: 'Web & network', icon: 'globe', blurb: 'Observe pages, captures, HAR files and packet recordings.' },
  { id: 'android', name: 'Android & devices', icon: 'smartphone', blurb: 'APKs, ADB devices, Flutter, HarmonyOS and JEB.' },
  { id: 'managed', name: '.NET / managed', icon: 'package', blurb: 'PE/CLI metadata, members and native boundaries.' },
  { id: 'firmware', name: 'Firmware', icon: 'chip', blurb: 'Firmware regions, extraction, UF2, ESP images.' },
  { id: 'runtime', name: 'Runtime & instrumentation', icon: 'activity', blurb: 'Process capture, Frida, debuggers and runtime observation.' },
  { id: 'evidence', name: 'Evidence & reconstruction', icon: 'shield', blurb: 'Compare, import, export and project saved Evidence.' },
  { id: 'environments', name: 'Agent environments', icon: 'box', blurb: 'Build RL environments from recorded sessions.' },
  { id: 'system', name: 'System', icon: 'settings', blurb: 'Provider and readiness checks.' },
  { id: 'other', name: 'Other', icon: 'dots', blurb: 'Everything else.' },
];

const RULES = [
  [/^(doctor|capabilities|providers)$/, 'system'],
  [/^environment-/, 'environments'],
  [/(adb|android|apk|apktool|flutter|dart|harmony|jeb)/, 'android'],
  [/(managed)/, 'managed'],
  [/(firmware|uf2|esp-|devicetree)/, 'firmware'],
  [/^(capture-process|compare-process-captures|instrument-with-frida|list-frida|debug-with|observe-javascript|list-javascript-runtime)/, 'runtime'],
  [/(javascript|electron|application|reconstruction|reference-source|source-to-bundle)/, 'javascript'],
  [/^(compare-web|capture-web|capture-browser|analyze-web|discover-web|export-web|inspect-web|list-browser|observe-web|trace-web|inspect-pcap|inspect-packet|compare-source)/, 'web'],
  [/^(compare|evidence-|inspect-analysis-view|inspect-evidence-bundle|import-|evaluate-)/, 'evidence'],
  [/^(inspect-(pe|elf|go|rust|gpu|il2cpp|kernel|erlang|python|model|wasm|evm|sqlite|byte|binary|artifact|desktop|signal|apple|recorded)|extract-artifact|decode-signal|compare-wasm|list-objdump|decode-android)/, 'binary'],
  [/^(decode-interface|analyze|inspect|function|decompile|instructions|search|trace|xrefs|read-bytes|address-to|annotate|resolve-native|match-native|observe-native|capture-native|list-architectures|demangle|execute-rizin|cutter|list-cutter|inspect-with)/, 'native'],
];
const categoryOf = (name) => {
  for (const [re, id] of RULES) if (re.test(name)) return id;
  return 'other';
};

// Commands that are managed elsewhere in the UI (or make no sense in a GUI).
const HIDDEN = new Set(['setup', 'uninstall', 'update', 'mcp', 'completions', 'environment-serve']);

// Risk: anything that runs a target/launches a process or mutates a device.
const EXECUTES = /^(capture-process|capture-electron-scenario|capture-browser-scenario|capture-native-ui-scenario|observe-native-calls|observe-native-ui|instrument-with-frida|debug-with-gdb|debug-with-rizin|execute-rizin-command|cutter-command|observe-web-execution|observe-web-session|observe-javascript-runtime)$/;
const DEVICE = /^(install-adb-package|uninstall-adb-package|push-adb-file|start-adb-activity|start-adb-app|stop-adb-app)$/;
const WRITES = /^(decompile-all|extract-artifact|extract-firmware|export-web-scripts|evidence-export|environment-build|environment-export|recover-javascript-sources|annotate-native-function|pull-adb-file|pull-adb-package|capture-adb-screen|collect-adb-bugreport)$/;
const riskOf = (name) => (EXECUTES.test(name) ? 'execute' : DEVICE.test(name) ? 'device' : WRITES.test(name) ? 'writes' : 'safe');

const kebab = (k) => (k.includes('_') ? k : k.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase());

const simplify = (key, s, required) => {
  let type = s.type;
  let enumVals = s.enum;
  let suggestions;
  if (!type && s.anyOf) {
    const consts = s.anyOf.filter((x) => x.const !== undefined).map((x) => x.const);
    const base = s.anyOf.find((x) => x.type && x.const === undefined);
    type = base?.type ?? 'string';
    if (consts.length && !base) enumVals = consts;
    else if (consts.length) suggestions = consts;
  }
  return {
    key,
    flag: kebab(key),
    type: type || 'string',
    enum: enumVals,
    suggestions,
    items: s.items?.type,
    itemsEnum: s.items?.enum,
    description: s.description || '',
    default: s.default,
    min: s.minimum,
    max: s.maximum,
    pattern: s.pattern,
    required: !!required,
  };
};

const commands = manifest.commands
  .filter((c) => !HIDDEN.has(c.name))
  .map((c) => {
    const schema = c.schema || {};
    const argProps = schema.args?.properties || {};
    const optProps = schema.options?.properties || {};
    const reqArgs = new Set(schema.args?.required || []);
    const reqOpts = new Set(schema.options?.required || []);
    return {
      name: c.name,
      description: c.description || '',
      category: categoryOf(c.name),
      risk: riskOf(c.name),
      args: Object.entries(argProps).map(([k, v]) => simplify(k, v, reqArgs.has(k))),
      options: Object.entries(optProps).map(([k, v]) => simplify(k, v, reqOpts.has(k))),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const out = { reaVersion: reaPkg.version, generatedAt: new Date().toISOString(), categories: CATEGORIES, commands };
const target = join(root, 'src', 'main', 'catalog.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(out));
const counts = {};
for (const c of commands) counts[c.category] = (counts[c.category] || 0) + 1;
console.log(`rea ${reaPkg.version}: ${commands.length} commands`, counts);
console.log('other:', commands.filter((c) => c.category === 'other').map((c) => c.name).join(', '));
