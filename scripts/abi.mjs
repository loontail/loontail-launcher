// Swap better-sqlite3's native binary between the Node ABI (vitest) and the
// Electron ABI (running the app). Both builds are cached under
// node_modules/better-sqlite3/.abi-cache keyed by ABI number, so switching after
// the first build of each target is a file copy instead of a two-minute rebuild.
//
// Usage: node scripts/abi.mjs node|electron

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..');
const MODULE_ROOT = path.join(PACKAGE_ROOT, 'node_modules', 'better-sqlite3');
const LIVE_BINARY = path.join(MODULE_ROOT, 'build', 'Release', 'better_sqlite3.node');
const CACHE_DIR = path.join(MODULE_ROOT, '.abi-cache');

const cachedBinary = (abi) => path.join(CACHE_DIR, `better_sqlite3.node-abi${abi}`);

// A loaded DLL cannot be overwritten on Windows (EBUSY) but it can be renamed:
// the holder keeps running against the renamed file while the new one takes the
// canonical name. Stale copies are swept on the next swap, once nothing holds
// them.
const installBinary = (from) => {
  const stale = `${LIVE_BINARY}.stale`;
  rmSync(stale, { force: true });
  try {
    copyFileSync(from, LIVE_BINARY);
    return;
  } catch (error) {
    if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;
  }
  renameSync(LIVE_BINARY, stale);
  copyFileSync(from, LIVE_BINARY);
};

const electronAbi = async () => {
  const electronVersion = JSON.parse(
    readFileSync(path.join(PACKAGE_ROOT, 'node_modules', 'electron', 'package.json'), 'utf8'),
  ).version;
  // node-abi maps an Electron version to its module version; read it from the
  // installed copy instead of hardcoding a table that goes stale every release.
  const { getAbi } = await import('node-abi');
  return getAbi(electronVersion, 'electron');
};

const rebuild = (target) => {
  if (target === 'node') {
    const nodeGyp = createRequire(import.meta.url).resolve('node-gyp/bin/node-gyp.js');
    // `rebuild` regenerates build/config.gypi, so it overwrites the Electron
    // header paths (nodedir -> ~/.electron-gyp) the electron target leaves behind.
    execFileSync(process.execPath, [nodeGyp, 'rebuild', '--release'], {
      cwd: MODULE_ROOT,
      stdio: 'inherit',
    });
    return;
  }
  execFileSync('npx', ['electron-rebuild', '-f', '-w', 'better-sqlite3'], {
    cwd: PACKAGE_ROOT,
    stdio: 'inherit',
    shell: true,
  });
};

const main = async () => {
  const target = process.argv[2];
  if (target !== 'node' && target !== 'electron') {
    console.error('usage: node scripts/abi.mjs node|electron');
    process.exit(2);
  }

  const abi = target === 'node' ? process.versions.modules : await electronAbi();
  const cached = cachedBinary(abi);

  if (existsSync(cached)) {
    installBinary(cached);
    console.log(`better-sqlite3: ${target} ABI ${abi} restored from cache`);
    return;
  }

  console.log(`better-sqlite3: no cached ${target} ABI ${abi} build, compiling…`);
  rebuild(target);
  mkdirSync(CACHE_DIR, { recursive: true });
  copyFileSync(LIVE_BINARY, cached);
  console.log(`better-sqlite3: ${target} ABI ${abi} built and cached`);
};

await main();
