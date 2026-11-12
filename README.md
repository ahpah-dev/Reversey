# Reversey

A polished desktop app for **[REA — Reverse Engineer Anything](https://github.com/morluto/rea)**.
Drop a file or folder on it, and Reversey recognizes what it is, proposes the right analyses, runs them
locally, and shows the evidence in a readable, searchable interface.

Reversey bundles the unmodified [`rea-agents`](https://www.npmjs.com/package/rea-agents) package (MIT) and
runs it under Electron's own Node runtime — no separate Node install, terminal or agent required.

## Highlights

- **Drop anything** — PE/ELF/Mach-O binaries, .NET assemblies, Electron apps & ASARs, APKs, HAR/SAZ/PCAP captures,
  SQLite, WASM, GGUF/safetensors, firmware… Reversey detects the type and offers one-click recommended analyses.
- **Every REA tool, generated** — 170+ commands in a searchable, categorized library. Each gets a form generated from
  REA's own schema (file/folder pickers, enums, JSON inputs with validation, live CLI preview, *Copy CLI*).
- **Results you can read** — Evidence cards (subject, hash, provider, confidence, limitations), data tables with paging,
  at-a-glance stats, a lazy, searchable JSON explorer that stays fast on large results, raw & log views, export.
- **Application explorer** — reconstruct a JavaScript/Electron app in summary mode and browse its modules and routes
  without loading hundreds of megabytes.
- **Workspace** — every run is saved locally; reopen, edit & re-run, export, delete. Live progress and cancel.
- **Health** — see which engines are ready (Hopper, Ghidra, IDA, JADX, Kuna…) and point REA at the ones you own.
- **Command palette** (`Ctrl+K`), drag & drop anywhere, dark/light themes, accent colors, density.
- **Safety rails** — first-run responsible-use acknowledgement; confirmation before any tool that launches a process or
  changes a device; sandboxed renderer with a strict CSP; nothing is uploaded.

## Run it

Requires Node.js 22+ and npm (only to install/build; the app itself uses Electron's runtime).

```bash
npm install
npm start
```

If your npm blocks dependency install scripts, the `postinstall` hook still fetches the Electron binary.

### Build installers

```bash
npm run pack   # unpacked app in release/win-unpacked
npm run dist   # NSIS installer + portable exe in release/
```

### Other scripts

| Script            | What it does                                                           |
| ----------------- | ---------------------------------------------------------------------- |
| `npm run catalog` | Regenerate `src/main/catalog.json` from the installed REA CLI manifest |
| `npm run icon`    | Re-render `assets/icon.png`                                            |
| `npm run shot`    | Drive the real app with Playwright and save screenshots (dev only)     |

Upgrading REA: bump `rea-agents` in `package.json`, `npm install`, then `npm run catalog`.

## Architecture

```
src/main      Electron main process: window, IPC, REA runner (rea.js), target detection (targets.js)
src/preload   contextBridge API (the only door between UI and main)
src/renderer  Vanilla-JS ES modules UI (no bundler): views/, lib/, styles.css
```

REA runs as a child process (`ELECTRON_RUN_AS_NODE=1`), always with `--format json`. Stdout streams to disk under the
app's data folder, so huge results never block the UI; stderr progress lines drive the live progress bar. The renderer
never receives arbitrary command lines — the main process rebuilds argv from REA's schema.

### AI-agent integration

REA can also run as an MCP server for agents like Claude Code, Codex or Cursor. Reversey does **not** register itself
as that server (its executable is the GUI). Use REA's own installer for that: `npx rea-agents setup`.

## Responsible use

REA is for lawful research, education, interoperability, preservation and analysis of software you own or are
authorized to examine. It must not be used to circumvent DRM, license checks, anti-cheat or access controls. See
`licenses/REA-DISCLAIMER.md` (also shown in the app under **About**). You must obtain commercial engines (Hopper, IDA,
JEB…) legally; Reversey grants no tool license.

## Licenses

Reversey's original code is released under the [Unlicense](LICENSE) (public domain).

That does not cover REA, which Reversey builds on. REA is MIT-licensed, Copyright (c) 2026 morluto, and its license
must stay with any copy of it: see `licenses/REA-LICENSE.txt` and [NOTICE.md](NOTICE.md), which lists exactly which
material is REA's (the bundled `rea-agents` package, the copied disclaimer, and the generated
`src/main/catalog.json`). REA's third-party components retain their own licenses.

Reversey is an independent project and is not affiliated with or endorsed by the REA project or any third-party tool
vendor.
