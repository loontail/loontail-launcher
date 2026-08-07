#!/usr/bin/env node
// Downloads the upstream `authlib-injector` jar into `vendor/authlib-injector/`
// so the packaged app can ship it via electron-builder's extraResources.
// Idempotent: skips the network round-trip when the right version is on disk.
//
// Version source of truth: `AUTHLIB_INJECTOR_VERSION` in
// `src/main/services/yggdrasil/authlibInjector.ts`. Bumping the constant there
// is enough; the next `npm run build` re-downloads the new jar and the old one
// stays behind (delete `vendor/authlib-injector/*.jar` to force a clean fetch).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..');
const VENDOR_DIR = path.join(PACKAGE_ROOT, 'vendor', 'authlib-injector');
const SOURCE_FILE = path.join(
  PACKAGE_ROOT,
  'src',
  'main',
  'services',
  'yggdrasil',
  'authlibInjector.ts',
);

const readVersion = () => {
  const source = readFileSync(SOURCE_FILE, 'utf8');
  const match = source.match(/export const AUTHLIB_INJECTOR_VERSION = ['"]([^'"]+)['"]/);
  if (!match) {
    throw new Error(
      `Could not find AUTHLIB_INJECTOR_VERSION in ${SOURCE_FILE} — adjust the regex if the export shape changed.`,
    );
  }
  return match[1];
};

const downloadUrl = (version) =>
  `https://github.com/yushijinhun/authlib-injector/releases/download/v${version}/authlib-injector-${version}.jar`;

const fetchJar = async (url) => {
  // Follow GitHub's redirect to the CDN that actually serves the asset.
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText} (${url})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  // A jar is a zip. Without this check an HTML error page saved under a .jar
  // name would package cleanly and only fail when the game refuses to start.
  if (buffer.length < 1024 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error(`Downloaded payload is not a jar archive (${buffer.length} bytes): ${url}`);
  }
  return buffer;
};

// why: the launcher relies on clause (a) of the authlib-injector AGPL exception,
// which holds only for the UNALTERED binary. Bundling a patched or substituted jar
// would pull the launcher's own code under the AGPL, and this script used to print
// the digest while verifying it against nothing. A version absent from this map is
// a hard failure, not a warning — the digest has to be recorded deliberately.
const EXPECTED_SHA256 = {
  '1.2.5': '3bc9ebdc583b36abd2a65b626c4b9f35f21177fbf42a851606eaaea3fd42ee0f',
};

const digestOf = (buffer) => createHash('sha256').update(buffer).digest('hex');

const assertDigest = (version, buffer, source) => {
  const actual = digestOf(buffer);
  const expected = EXPECTED_SHA256[version];
  if (!expected) {
    throw new Error(
      `No pinned sha256 for authlib-injector ${version}. Add "${version}": "${actual}" to EXPECTED_SHA256 in ${import.meta.filename} after confirming it against the upstream release.`,
    );
  }
  if (actual !== expected) {
    throw new Error(
      `authlib-injector ${version} digest mismatch (${source}): expected ${expected}, got ${actual}. The jar must be the unaltered official build.`,
    );
  }
};

const main = async () => {
  const version = readVersion();
  const jarFilename = `authlib-injector-${version}.jar`;
  const jarPath = path.join(VENDOR_DIR, jarFilename);

  mkdirSync(VENDOR_DIR, { recursive: true });

  if (existsSync(jarPath)) {
    assertDigest(version, readFileSync(jarPath), jarPath);
    console.log(`[authlib-injector] ${jarFilename} already vendored and digest-verified.`);
    return;
  }

  const url = downloadUrl(version);
  console.log(`[authlib-injector] Downloading ${url}`);
  const buffer = await fetchJar(url);
  assertDigest(version, buffer, url);
  writeFileSync(jarPath, buffer);
  console.log(
    `[authlib-injector] Wrote ${jarPath} (${buffer.length} bytes, sha256=${digestOf(buffer)}).`,
  );
};

main().catch((error) => {
  console.error('[authlib-injector] Fetch failed:', error);
  process.exit(1);
});
