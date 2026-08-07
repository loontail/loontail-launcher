#!/usr/bin/env node
/**
 * Design screenshot harness (Playwright + Electron).
 *
 * Launches the *built* launcher as a real Electron app, drives it to each
 * defined screen, and writes a PNG per screen. Unlike a plain browser, this
 * runs the actual app with its preload bridge and IPC intact, so screens that
 * depend on `window.api` and the sqlite-backed store (home, settings) render for
 * real.
 *
 * Usage:
 *   npm run shots            # build, then screenshot into .shots/
 *   npm run shots -- before  # screenshot into .shots/before/ (keep a baseline)
 *   node scripts/screenshot.mjs   # screenshot only (assumes out/ is already built)
 *
 * Reads the user's real userData, so it reflects your actual logged-in state.
 * Close any running launcher first — Electron's single-instance lock makes a
 * second copy exit immediately, leaving the harness with no window to capture.
 *
 * Add screens by appending to SCREENS. `prepare` navigates to the screen;
 * `after` returns to a clean starting point for the next one. Both are
 * tolerant: if a screen isn't reachable in the current state (e.g. signed out),
 * the harness logs it and captures whatever is on screen instead of failing.
 *
 * Exit codes:
 *   0 — captured (some screens may have been skipped)
 *   1 — could not launch / no window
 */

import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_ENTRY = path.join(ROOT, 'out', 'main', 'index.js');
const LABEL = process.argv[2]?.replace(/[^a-z0-9._-]/gi, '') ?? '';
const OUT_DIR = LABEL ? path.join(ROOT, '.shots', LABEL) : path.join(ROOT, '.shots');

const VIEWPORT = {
  width: Number(process.env.SHOTS_W) || 1000,
  height: Number(process.env.SHOTS_H) || 624,
};

// lucide-react renders each icon as `svg.lucide-<name>`, so these locators are
// independent of the (i18n-translated) aria-labels on the buttons.
// The top nav uses text tabs ("Home"/"Builds") + an icon settings button
// (aria-label "Settings"). Catalog/recent build cards carry [data-build-card]
// so detail navigation is independent of card markup.
const goBuilds = (page) =>
  page.getByRole('button', { name: 'Builds', exact: true }).first().click({ timeout: 4000 });

const SCREENS = [
  {
    // The authenticated app opens on Home (the dashboard).
    name: 'home',
    prepare: async () => {},
  },
  {
    name: 'builds',
    prepare: async (page) => {
      await goBuilds(page);
    },
  },
  {
    name: 'build-detail',
    prepare: async (page) => {
      await goBuilds(page);
      await settle(600);
      await page.locator('[data-build-card]').first().click({ timeout: 5000 });
      await settle(500);
    },
    after: async (page) => {
      await page
        .getByRole('button', { name: /^(Back|Builds|Home)$/ })
        .first()
        .click({ timeout: 4000 })
        .catch(() => {});
    },
  },
  {
    name: 'settings',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Settings' }).first().click({ timeout: 4000 });
    },
    after: async (page) => {
      // Settings collapses the bar to a single back arrow (aria-label "Back") that
      // sits where the Settings icon was — there's no Home/Builds tab to click.
      await page
        .getByRole('button', { name: 'Back', exact: true })
        .first()
        .click({ timeout: 4000 })
        .catch(() => {});
    },
  },
  {
    name: 'builds-list',
    prepare: async (page) => {
      await goBuilds(page);
      await settle(400);
      await page.getByRole('radio', { name: 'List view' }).first().click({ timeout: 4000 });
      await settle(400);
    },
    after: async (page) => {
      await page
        .getByRole('radio', { name: 'Grid view' })
        .first()
        .click({ timeout: 4000 })
        .catch(() => {});
    },
  },
  {
    name: 'create-modal',
    prepare: async (page) => {
      await goBuilds(page);
      await settle(400);
      await page.getByRole('button', { name: 'Create build' }).first().click({ timeout: 4000 });
      await settle(400);
    },
    after: async (page) => {
      await page.keyboard.press('Escape').catch(() => {});
    },
  },
  {
    name: 'settings-modal',
    prepare: async (page) => {
      await goBuilds(page);
      await settle(500);
      await page.locator('[data-build-card]').first().click({ timeout: 5000 });
      await settle(500);
      await page.getByRole('button', { name: 'Settings' }).first().click({ timeout: 4000 });
      await settle(400);
    },
    after: async (page) => {
      await page.keyboard.press('Escape').catch(() => {});
      await page
        .getByRole('button', { name: /^(Back|Builds|Home)$/ })
        .first()
        .click({ timeout: 4000 })
        .catch(() => {});
    },
  },
];

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForReady = async (page) => {
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  // Bootstrap shows a full-screen spinner; let it clear before we capture.
  await page
    .locator('.animate-spin')
    .first()
    .waitFor({ state: 'detached', timeout: 8000 })
    .catch(() => {});
  await settle(600);
};

const main = async () => {
  if (!existsSync(APP_ENTRY)) {
    console.error(
      `[shots] ${path.relative(ROOT, APP_ENTRY)} not found — run \`npm run shots\` (builds first) or \`npm run build\`.`,
    );
    process.exitCode = 1;
    return;
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  // Empty ELECTRON_RENDERER_URL forces the prod file-load path in
  // rendererLocations.ts (no dev server, no detached devtools).
  // ELECTRON_RUN_AS_NODE is set by Electron-based parent processes (e.g. VS Code's
  // integrated terminal). It makes the electron binary run as plain Node, so
  // `require('electron').app` is undefined and the app crashes on startup. Strip it
  // so Playwright launches a real GUI process.
  const launchEnv = { ...process.env, ELECTRON_RENDERER_URL: '', NODE_ENV: 'production' };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  // Optionally point at a specific Electron profile (e.g. a logged-in one) so the
  // harness can capture authenticated screens that the default fresh profile gates.
  const userDataArgs = process.env.SHOTS_USER_DATA
    ? [`--user-data-dir=${process.env.SHOTS_USER_DATA}`]
    : [];
  // --no-sandbox/--disable-gpu let Electron launch under Playwright in headless or
  // CI-like contexts where the Chromium sandbox/GPU bring-up otherwise aborts startup.
  const app = await electron.launch({
    args: [APP_ENTRY, '--no-sandbox', '--disable-gpu', ...userDataArgs],
    cwd: ROOT,
    timeout: 60000,
    env: launchEnv,
  });

  let page;
  try {
    page = await app.firstWindow({ timeout: 20000 });
  } catch {
    console.error(
      '[shots] no window appeared — is another launcher instance already running? Close it and retry.',
    );
    await app.close();
    process.exitCode = 1;
    return;
  }

  const win = await app.browserWindow(page);
  await win
    .evaluate((w, size) => w.setContentSize(size.width, size.height), VIEWPORT)
    .catch(() => {});
  await waitForReady(page);

  for (const screen of SCREENS) {
    try {
      if (screen.prepare) await screen.prepare(page);
      await waitForReady(page);
    } catch (err) {
      console.warn(
        `[shots] "${screen.name}" not reachable (${err.message}) — capturing current state`,
      );
    }
    const file = path.join(OUT_DIR, `${screen.name}.png`);
    await page.screenshot({ path: file, scale: 'device' });
    console.log(`[shots] ${screen.name} -> ${path.relative(ROOT, file)}`);
    if (screen.after) await screen.after(page).catch(() => {});
    await settle(300);
  }

  await app.close();
};

main().catch((err) => {
  console.error('[shots] failed:', err);
  process.exitCode = 1;
});
