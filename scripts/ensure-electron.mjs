// Newer npm versions block dependency install scripts, which skips Electron's
// binary download. Make sure the binary exists after `npm install`.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let pkgDir;
try {
  pkgDir = dirname(require.resolve('electron/package.json'));
} catch {
  process.exit(0); // electron not installed (e.g. production-only install)
}
const hasBinary = existsSync(join(pkgDir, 'path.txt')) && existsSync(join(pkgDir, 'dist'));
if (!hasBinary) {
  console.log('Downloading the Electron binary…');
  const r = spawnSync(process.execPath, [join(pkgDir, 'install.js')], { stdio: 'inherit' });
  process.exit(r.status ?? 0);
}
