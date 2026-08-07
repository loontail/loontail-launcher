#!/usr/bin/env node
// Generates THIRD-PARTY-NOTICES.md and ships it via electron-builder's
// extraResources (see electron-builder.yml). Run from scripts/beforePack.mjs, so
// it happens however electron-builder was invoked.
//
// why: attribution used to reach users only as a side effect of the whole
// production node_modules tree being packed into app.asar. The moment `files:` is
// tightened, pruning is enabled, or the app moves to the electron-vite bundle
// alone, every MIT/BSD copyright notice and the OFL font licence would silently
// disappear from the shipped app with nothing failing. A generated file next to
// the binary survives all of that.
//
// The package set comes from package-lock.json (lockfileVersion 3 records a
// `license` for every entry), not from `npm ls`, so the output is deterministic
// and needs no network or npm process.
//
// why every entry, including the dev tree: electron-vite bundles renderer/main
// dependencies into out/**, so "shipped" does not follow npm's dev/prod split.
// @fontsource/nunito is a devDependency whose OFL-1.1 woff2 files are emitted
// into out/renderer/assets and do reach users — a production-only filter drops
// exactly the notice OFL §2 requires. Listing a package whose bytes are not
// shipped costs a paragraph; omitting one that is shipped is the compliance
// failure, so this errs toward over-inclusion.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'THIRD-PARTY-NOTICES.md');
const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\..*)?$/i;

const readLicenceText = (dir) => {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir)
    .filter((name) => LICENCE_FILE.test(name))
    .filter((name) => statSync(path.join(dir, name)).isFile())
    .sort();
  if (names.length === 0) return null;
  return names
    .map((name) => `${name}:\n\n${readFileSync(path.join(dir, name), 'utf8').trim()}`)
    .join('\n\n');
};

const collect = () => {
  const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  if (lock.lockfileVersion < 3) {
    throw new Error(
      `package-lock.json is v${lock.lockfileVersion}; this script needs v3 or newer.`,
    );
  }
  const seen = new Map();
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location.startsWith('node_modules/')) continue;
    const name =
      entry.name ?? location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const key = `${name}@${entry.version}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      name,
      version: entry.version,
      license: entry.license ?? null,
      text: readLicenceText(path.join(ROOT, location)),
    });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
};

// Copyleft that reaches users through Electron and extraResources rather than
// through the npm production tree — the two paths an `npm ls` audit misses.
const PREAMBLE = `# Third-party notices

Loontail Minecraft Launcher is distributed under the MIT licence; its own terms
are in \`LICENSE.md\` beside this file. The components below are redistributed
with it and keep their own terms.

## Electron and Chromium

The launcher embeds Electron. Electron's own notice is \`LICENSE.electron.txt\`
and the complete Chromium third-party notices (including every copyleft
component reached through it) are in \`LICENSES.chromium.html\`, both installed
one directory above this file. They are referenced rather than duplicated here.

\`ffmpeg.dll\` is FFmpeg, licensed LGPL-2.1-or-later. It ships as a separate,
replaceable shared library — it is not statically linked into the application —
so it can be substituted with a user-built copy. Sources: https://ffmpeg.org

## authlib-injector

\`authlib-injector/\` holds the unaltered official authlib-injector jar,
(C) yushijinhun, licensed AGPLv3 with the authlib-injector exception. The full
licence text ships inside the jar at \`META-INF/licenses/authlib-injector.txt\`,
and \`authlib-injector/NOTICE.md\` records the exception, this launcher's use of
it, and where to obtain the corresponding source.

## Java runtime, Minecraft assets and mod loaders

Not redistributed. The Java runtime, the game's own files, Fabric and Forge are
downloaded by your machine directly from Mojang, FabricMC and MinecraftForge at
install time, under their own terms.

## npm packages

`;

const render = (packages) => {
  const lines = [PREAMBLE.trimEnd(), ''];
  for (const pkg of packages) {
    lines.push(`### ${pkg.name} ${pkg.version}`, '');
    lines.push(`License: ${pkg.license ?? 'see the package repository'}`, '');
    if (pkg.text) {
      lines.push('```', pkg.text, '```', '');
    } else {
      // The package shipped no licence file of its own; the SPDX id above is the
      // grant on record in its manifest.
      lines.push(
        `No licence file ships in this package. Full text: https://www.npmjs.com/package/${pkg.name}`,
        '',
      );
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
};

const packages = collect();
if (packages.length === 0) {
  console.error(
    '[notices] No production packages found — refusing to write an empty notices file.',
  );
  process.exit(1);
}
writeFileSync(OUT, render(packages), 'utf8');
const withoutText = packages.filter((pkg) => !pkg.text).length;
console.log(
  `[notices] Wrote ${OUT} (${packages.length} packages, ${withoutText} with no licence file of their own — each is named in the file with its SPDX id).`,
);
