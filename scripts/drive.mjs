// Dev-only: drives the real Electron app with Playwright and saves screenshots.
// Usage: node scripts/drive.mjs <scenario>
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronBin = require('electron');
const shots = join(root, 'shots');
mkdirSync(shots, { recursive: true });

const scenario = process.argv[2] || 'home';
const userData = join(tmpdir(), `reversey-test-${scenario}`);
rmSync(userData, { recursive: true, force: true });
mkdirSync(userData, { recursive: true });
const withConsent = scenario !== 'consent';
if (withConsent) writeFileSync(join(userData, 'settings.json'), JSON.stringify({ consentVersion: 1, theme: process.env.THEME || 'dark' }));

const env = { ...process.env, REVERSEY_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: process.env.EXE || electronBin, args: process.env.EXE ? [] : [root], env });
const page = await app.firstWindow();
const errors = [];
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.setViewportSize({ width: 1360, height: 860 }).catch(() => {});
await page.waitForSelector('body.ready', { timeout: 15000 });

const go = async (hash, wait = 600) => {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.waitForTimeout(wait);
};
const shot = async (name) => {
  await page.screenshot({ path: join(shots, `${name}.png`) });
  console.log('shot', name);
};

try {
  const scenarios = {
    consent: async () => {
      await page.waitForTimeout(500);
      await shot('consent');
    },
    home: async () => {
      await shot('home');
      await go('#/tools');
      await shot('tools');
      await go('#/tool/inspect-pe-imports');
      await shot('toolform');
      await go('#/tool/analyze-javascript-application');
      await shot('toolform-js');
    },
    palette: async () => {
      await page.keyboard.press('Control+k');
      await page.keyboard.type('pe imp');
      await page.waitForTimeout(400);
      await shot('palette');
    },
    health: async () => {
      await go('#/health', 9000);
      await shot('health');
      await go('#/settings');
      await shot('settings');
      await go('#/about');
      await shot('about');
      await go('#/workspace');
      await shot('workspace-empty');
    },
    target: async () => {
      const t = process.env.TARGET || 'C:/Windows/System32/calc.exe';
      await go(`#/target?path=${encodeURIComponent(t)}`, 800);
      await shot('target');
      await page.getByText('Quick scan').first().waitFor();
      await page.locator('.rec-card', { hasText: 'Quick scan' }).getByRole('button', { name: 'Run', exact: true }).click();
      await page.waitForSelector('.tabs', { timeout: 60000 });
      await page.waitForTimeout(500);
      await shot('result-overview');
      await page.getByRole('tab', { name: 'Explorer' }).click();
      await page.waitForTimeout(500);
      await shot('result-explorer');
      await page.getByRole('tab', { name: 'Raw' }).click();
      await shot('result-raw');
    },
    confirm: async () => {
      await go('#/tool/capture-process');
      await page.locator('input[type=text]').first().fill('C:/scenario.json');
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await page.waitForSelector('.modal', { timeout: 5000 });
      await shot('confirm-risk');
      await page.getByRole('button', { name: 'Cancel' }).click();
    },
    cancel: async () => {
      const t = process.env.TARGET;
      await go('#/tool/analyze-javascript-application');
      await page.locator('input[type=text]').first().fill(t);
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await page.waitForSelector('.live', { timeout: 10000 });
      await page.waitForTimeout(6000);
      await shot('running');
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page.waitForSelector('.callout-warn', { timeout: 15000 });
      await shot('cancelled');
    },
    error: async () => {
      await go('#/tool/inspect-pe-imports');
      await page.locator('input[type=text]').first().fill('C:/nope/missing.exe');
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await page.waitForSelector('.error-card', { timeout: 30000 });
      await shot('result-error');
    },
    js: async () => {
      const t = process.env.TARGET;
      await go(`#/target?path=${encodeURIComponent(t)}`, 800);
      await shot('target-js');
      await page.locator('.rec-card', { hasText: 'Reconstruct application' }).getByRole('button', { name: 'Run', exact: true }).click();
      await page.waitForSelector('.tabs', { timeout: 120000 });
      await page.waitForTimeout(600);
      await shot('result-js');
      for (const [btnName, shotName] of [['Summary', 'result-js-summary'], ['Routes', 'result-js-routes'], ['Modules', 'result-js-modules']]) {
        await page.getByRole('button', { name: btnName, exact: true }).click();
        await page.waitForSelector('.tabs', { timeout: 60000 });
        await page.waitForTimeout(700);
        await shot(shotName);
        await page.goBack();
        await page.waitForSelector('.explorer-card', { timeout: 10000 });
      }
    },
  };
  await scenarios[scenario]();
} catch (e) {
  console.error('SCENARIO FAILED', e.message);
  await shot(`${scenario}-failure`).catch(() => {});
  process.exitCode = 1;
}
console.log('console issues:', errors.length ? `\n${errors.join('\n')}` : 'none');
await app.close();
