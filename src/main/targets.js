'use strict';
// Detects what a dropped file / folder is and proposes analyses for it.
const fs = require('node:fs');
const path = require('node:path');

const MB = 1024 * 1024;

function readHead(file, bytes = 4096) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

// Cheap scan for a marker in the first `limit` bytes of a file.
function fileContains(file, needle, limit = 24 * MB) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const total = Math.min(size, limit);
    const chunk = Buffer.alloc(4 * MB);
    const tail = needle.length - 1;
    let pos = 0;
    let carry = Buffer.alloc(0);
    while (pos < total) {
      const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, total - pos), pos);
      if (n <= 0) break;
      const hay = Buffer.concat([carry, chunk.subarray(0, n)]);
      if (hay.includes(needle)) return true;
      carry = hay.subarray(Math.max(0, hay.length - tail));
      pos += n;
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

const KIND_LABEL = {
  pe: 'Windows PE',
  dotnet: '.NET assembly',
  elf: 'ELF binary',
  macho: 'Mach-O binary',
  asar: 'Electron ASAR archive',
  'js-app': 'JavaScript / Electron app',
  'electron-install': 'Packaged Electron app',
  'app-bundle': 'Apple app bundle',
  apk: 'Android APK',
  jar: 'Java archive',
  ipa: 'iOS app archive',
  zip: 'ZIP archive',
  wasm: 'WebAssembly module',
  sqlite: 'SQLite database',
  gguf: 'GGUF model',
  safetensors: 'Safetensors model',
  har: 'HAR network capture',
  saz: 'Fiddler SAZ capture',
  pcap: 'Packet capture',
  ips: 'Apple crash report',
  pyc: 'Python bytecode',
  beam: 'Erlang BEAM',
  dtb: 'Devicetree blob',
  uf2: 'UF2 firmware',
  firmware: 'Firmware image',
  evidence: 'REA Evidence JSON',
  dir: 'Folder',
  unknown: 'Unknown file',
};

// Suggestion: { command, title, why, quick, args?, options?, pathOverride? }
const S = {
  scan: { command: 'inspect-artifact', title: 'Quick scan', why: 'Inventory, format and every available static observation, plus next probes.', quick: true },
  entropy: { command: 'inspect-byte-entropy', title: 'Entropy map', why: 'Spot packed or encrypted regions.', quick: true },
  layout: { command: 'inspect-binary-layout', title: 'Layout', why: 'Sections, segments and linked layout.', quick: true },
  analyze: { command: 'analyze', title: 'Deep analysis', why: 'Overview with a disassembler engine (Hopper, Ghidra, IDA or Kuna).', quick: false },
  peImports: { command: 'inspect-pe-imports', title: 'Imports', why: 'Import and delay-load DLLs, ordinals, imphash.', quick: true },
  peCerts: { command: 'inspect-pe-certificates', title: 'Signatures', why: 'Authenticode certificate identities.', quick: true },
  peRes: { command: 'inspect-pe-resources', title: 'Resources', why: 'Resource identities, payload ranges, icon groups.', quick: true },
  peLoad: { command: 'inspect-pe-load-config', title: 'Load config & TLS', why: 'TLS callbacks and load configuration.', quick: true },
  exports: { command: 'inspect-native-exports', title: 'Exports', why: 'PE / ELF export table.', quick: true },
  go: { command: 'inspect-go-binary', title: 'Go build info', why: 'Compiler version, modules and build settings.', quick: true },
  rust: { command: 'inspect-rust-binary', title: 'Rust crates', why: 'Embedded cargo-auditable dependency list.', quick: true },
  managed: { command: 'inspect-managed-artifact', title: '.NET identity', why: 'PE/CLI identity and metadata.', quick: true },
  managedMembers: { command: 'inspect-managed-members', title: '.NET members', why: 'Types, methods, CIL anchors and string literals.', quick: true },
  managedNative: { command: 'inspect-managed-native-boundaries', title: 'P/Invoke boundaries', why: 'Native calls declared by managed code.', quick: true },
  elfNotes: { command: 'inspect-elf-notes', title: 'ELF notes', why: 'GNU build-id, ABI tag and note owners.', quick: true },
  kernel: { command: 'inspect-kernel-module', title: 'Kernel module', why: 'modinfo, version CRCs and signature trailer.', quick: true },
  macho: { command: 'inspect-macho', title: 'Mach-O', why: 'Headers, load commands and architectures.', quick: true },
  sig: { command: 'inspect-signature', title: 'Code signature', why: 'Apple code signature details.', quick: true },
  archs: { command: 'list-architectures', title: 'Architectures', why: 'Slices in a fat Mach-O.', quick: true },
  js: { command: 'analyze-javascript-application', title: 'Reconstruct application', why: 'Modules, imports, routes, IPC and Electron boundaries.', quick: true },
  fuses: { command: 'inspect-electron-fuses', title: 'Electron fuses', why: 'Packaged fuse bytes, without launching the app.', quick: true },
  desktop: { command: 'inspect-desktop-application', title: 'Runtime candidates', why: 'Identify the runtime from bounded directory and header facts.', quick: true },
  extract: { command: 'extract-artifact', title: 'Extract contents', why: 'Unpack regular contents of the artifact (needs an output folder).', quick: false },
  apk: { command: 'inspect-android-package', title: 'Manifest & classes', why: 'Declarations and decoded manifest, without executing.', quick: true },
  apkSig: { command: 'inspect-apk-signature', title: 'APK signatures', why: 'v1–v3.1 signers and digests.', quick: true },
  apkRes: { command: 'decode-android-resources', title: 'Decode resources', why: 'Manifest, strings and locales (needs apktool).', quick: false },
  flutter: { command: 'identify-flutter-build', title: 'Flutter build', why: 'Dart snapshot hash and engine facts.', quick: true },
  wasm: { command: 'inspect-wasm-artifact', title: 'WASM interface', why: 'Validation, sections, imports and exports (needs WABT).', quick: false },
  sqlite: { command: 'inspect-sqlite-database', title: 'Schema & rows', why: 'Tables, columns, indexes and selected rows.', quick: true },
  model: { command: 'inspect-model-artifact', title: 'Model header', why: 'Tensor declarations and metadata, without loading weights.', quick: true },
  har: { command: 'inspect-web-network-capture', title: 'Network records', why: 'Requests, responses and exposed payloads.', quick: true, argsFn: (p, k) => ({ capturePath: p, format: k }) },
  pcap: { command: 'inspect-pcap-capture', title: 'Packet summary', why: 'Endpoints, DNS, TLS SNI and protocols (needs tshark).', quick: false },
  ips: { command: 'inspect-apple-ips', title: 'Crash report', why: 'Threads, images, registers and crash class.', quick: true },
  pyc: { command: 'inspect-python-pyc', title: 'Bytecode', why: 'Header and marshalled code objects.', quick: true },
  beam: { command: 'inspect-erlang-beam', title: 'BEAM chunks', why: 'Atoms, exports, imports and code header.', quick: true },
  dtb: { command: 'inspect-devicetree', title: 'Devicetree', why: 'Flattened devicetree nodes and properties.', quick: true },
  fwRegions: { command: 'inspect-firmware-regions', title: 'Firmware regions', why: 'Signature candidates without extraction.', quick: true },
  plist: { command: 'inspect-plist', title: 'Info.plist', why: 'App plist metadata.', quick: true },
};

const BY_KIND = {
  pe: ['scan', 'peImports', 'peCerts', 'peRes', 'peLoad', 'exports', 'entropy', 'layout', 'go', 'rust', 'managed', 'analyze'],
  dotnet: ['scan', 'managed', 'managedMembers', 'managedNative', 'peImports', 'peCerts', 'peRes', 'entropy', 'analyze'],
  elf: ['scan', 'elfNotes', 'exports', 'layout', 'entropy', 'go', 'rust', 'analyze'],
  macho: ['scan', 'macho', 'sig', 'archs', 'layout', 'entropy', 'go', 'rust', 'analyze'],
  asar: ['js', 'scan', 'fuses', 'desktop', 'extract'],
  'js-app': ['js', 'desktop', 'fuses', 'scan'],
  'electron-install': ['js', 'desktop', 'fuses', 'scan'],
  'app-bundle': ['scan', 'plist', 'desktop', 'macho', 'js'],
  apk: ['apk', 'apkSig', 'flutter', 'apkRes', 'scan'],
  jar: ['scan', 'extract'],
  ipa: ['scan', 'extract'],
  zip: ['scan', 'extract'],
  wasm: ['scan', 'wasm'],
  sqlite: ['sqlite', 'scan'],
  gguf: ['model', 'scan'],
  safetensors: ['model', 'scan'],
  har: ['har'],
  saz: ['har'],
  pcap: ['pcap', 'scan'],
  ips: ['ips'],
  pyc: ['pyc', 'scan'],
  beam: ['beam', 'scan'],
  dtb: ['dtb', 'scan'],
  uf2: ['fwRegions', 'scan'],
  firmware: ['fwRegions', 'scan', 'entropy', 'extract'],
  dir: ['desktop', 'js', 'scan'],
  unknown: ['scan', 'entropy', 'layout', 'fwRegions'],
};

function classify(p, stat) {
  const name = path.basename(p);
  const ext = path.extname(name).toLowerCase();
  const out = { kinds: [], path: p };

  if (stat.isDirectory()) {
    const has = (rel) => {
      try {
        return fs.existsSync(path.join(p, rel));
      } catch {
        return false;
      }
    };
    if (ext === '.app' || has('Contents/Info.plist')) out.kinds.push('app-bundle');
    if (has('resources/app.asar') || has('resources/app/package.json') || has('Resources/app.asar')) {
      out.kinds.push('electron-install');
      out.jsTarget = has('resources/app.asar')
        ? path.join(p, 'resources', 'app.asar')
        : has('Resources/app.asar')
          ? path.join(p, 'Resources', 'app.asar')
          : path.join(p, 'resources', 'app');
    }
    if (has('package.json')) out.kinds.push('js-app');
    if (!out.kinds.length) out.kinds.push('dir');
    return out;
  }

  let head = Buffer.alloc(0);
  try {
    head = readHead(p, 4096);
  } catch {
    /* unreadable; fall through to extension heuristics */
  }
  const startsWith = (s) => head.subarray(0, s.length).toString('latin1') === s;
  const hex4 = head.length >= 4 ? head.subarray(0, 4).toString('hex') : '';

  if (ext === '.asar') out.kinds.push('asar');
  else if (startsWith('MZ')) {
    out.kinds.push('pe');
    try {
      if (fileContains(p, Buffer.from('BSJB', 'latin1'), 16 * MB) && fileContains(p, Buffer.from('mscoree.dll', 'latin1'), 16 * MB)) out.kinds.unshift('dotnet');
    } catch {
      /* ignore */
    }
  } else if (startsWith('\x7fELF')) {
    out.kinds.push('elf');
    if (ext === '.ko') out.kinds.unshift('elf');
  } else if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca'].includes(hex4) && !(ext === '.class' || ext === '.jar')) out.kinds.push('macho');
  else if (startsWith('\0asm')) out.kinds.push('wasm');
  else if (startsWith('SQLite format 3\0')) out.kinds.push('sqlite');
  else if (startsWith('GGUF')) out.kinds.push('gguf');
  else if (ext === '.safetensors') out.kinds.push('safetensors');
  else if (startsWith('UF2\n')) out.kinds.push('uf2');
  else if (startsWith('FOR1') && head.subarray(8, 12).toString('latin1') === 'BEAM') out.kinds.push('beam');
  else if (hex4 === 'd00dfeed') out.kinds.push('dtb');
  else if (startsWith('PK')) {
    if (ext === '.apk' || ext === '.xapk' || ext === '.aab') out.kinds.push('apk');
    else if (ext === '.jar' || ext === '.war') out.kinds.push('jar');
    else if (ext === '.ipa') out.kinds.push('ipa');
    else if (ext === '.saz') out.kinds.push('saz');
    else out.kinds.push('zip');
  } else if (['.pcap', '.pcapng', '.cap'].includes(ext) || ['d4c3b2a1', 'a1b2c3d4', '0a0d0d0a'].includes(hex4)) out.kinds.push('pcap');
  else if (ext === '.har') out.kinds.push('har');
  else if (ext === '.ips') out.kinds.push('ips');
  else if (ext === '.pyc') out.kinds.push('pyc');
  else if (ext === '.beam') out.kinds.push('beam');
  else if (ext === '.dtb') out.kinds.push('dtb');
  else if (['.bin', '.img', '.rom', '.fw', '.trx', '.squashfs'].includes(ext)) out.kinds.push('firmware');
  else if (ext === '.json') {
    const text = head.toString('utf8');
    if (/"evidence_id"/.test(text) || /"predicate_type"/.test(text)) out.kinds.push('evidence');
  }
  if (!out.kinds.length) out.kinds.push('unknown');
  return out;
}

function detect(p, catalogByName) {
  const stat = fs.statSync(p);
  const info = classify(p, stat);
  const primary = info.kinds[0];
  const keys = [];
  for (const k of info.kinds) for (const s of BY_KIND[k] || []) if (!keys.includes(s)) keys.push(s);
  if (!keys.length) keys.push('scan');

  const suggestions = [];
  for (const key of keys) {
    const def = S[key];
    const cmd = catalogByName.get(def.command);
    if (!cmd) continue;
    let target = p;
    if (info.jsTarget && (key === 'js' || key === 'fuses')) target = info.jsTarget;
    const args = def.argsFn ? def.argsFn(target, primary) : { [cmd.args[0]?.key || 'path']: target };
    suggestions.push({
      key,
      command: def.command,
      title: def.title,
      why: def.why,
      quick: !!def.quick,
      risk: cmd.risk,
      args,
      pathOverride: target !== p ? target : undefined,
    });
  }

  return {
    path: p,
    name: path.basename(p) || p,
    isDir: stat.isDirectory(),
    size: stat.isDirectory() ? null : stat.size,
    modified: stat.mtimeMs,
    kinds: info.kinds,
    kindLabels: info.kinds.map((k) => KIND_LABEL[k] || k),
    primaryLabel: KIND_LABEL[primary] || primary,
    suggestions,
  };
}

module.exports = { detect, KIND_LABEL };
