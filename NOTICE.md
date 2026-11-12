# Notice

Reversey's **original code** is released into the public domain under the [Unlicense](LICENSE).
That dedication does not extend to the third-party material below, which keeps its own license.

## REA (MIT) — Copyright (c) 2026 morluto

Reversey is a front-end for [REA — Reverse Engineer Anything](https://github.com/morluto/rea).
REA is licensed under the MIT License; the full text, including its copyright and permission notice, is in
[`licenses/REA-LICENSE.txt`](licenses/REA-LICENSE.txt). The MIT notice must be kept with any copy of the REA
material below.

| Material | How it is used | Where |
| --- | --- | --- |
| `rea-agents` npm package (unmodified) | Runtime dependency, executed as a child process. Installed from npm, not stored in this repository, but included in built installers. | `node_modules/rea-agents` (see its `LICENSE` and `THIRD_PARTY_NOTICES.md`) |
| REA's `DISCLAIMER.md` | Copied verbatim and shown in the app under **About**. | [`licenses/REA-DISCLAIMER.md`](licenses/REA-DISCLAIMER.md) |
| REA CLI command manifest (names, descriptions, option schemas) | Extracted by `scripts/gen-catalog.mjs` to build the tool library. | `src/main/catalog.json` (generated) |

`src/main/catalog.json` is derived from REA's CLI manifest, so treat it as MIT-licensed REA material
(Copyright (c) 2026 morluto), not as public-domain Reversey code.

## Other third-party software

- **Electron** (MIT) and **Chromium** (various open-source licenses) are bundled in built applications; their license
  files (`LICENSE.electron.txt`, `LICENSES.chromium.html`) ship next to the executable.
- **electron-builder** and other development tools are used only at build time.
- The analysis engines REA can drive (Hopper, Ghidra, IDA, JADX, Kuna, …) are **not** included. They keep their own
  licenses and must be obtained legally by the user.

## No affiliation

Reversey is an independent project. It is not affiliated with or endorsed by the REA project or any third-party tool
vendor.
