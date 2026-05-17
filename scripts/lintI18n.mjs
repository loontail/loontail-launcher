#!/usr/bin/env node
/**
 * Static i18n key linter. Walks every TS/TSX file under src/, then for each
 * leaf key in src/renderer/i18n/locales/*.json checks whether the literal key
 * text appears anywhere in source. Cheap, low false-positive: as long as the
 * key path lands in source as a string literal (in a `t()` call, lookup table,
 * or `recordSystem({ code: '…' })`) it counts as referenced.
 *
 * Dynamic templates like `t(`clients.stage.${stage}`)` are conservatively
 * allowed: any locale leaf whose path starts with a captured template prefix
 * is treated as referenced.
 *
 * Exit:
 *   0 — clean
 *   1 — missing references (key used in code but absent from a locale)
 *   2 — unused locale keys
 *   3 — both
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'src');
const LOCALES_DIR = path.join(ROOT, 'src/renderer/i18n/locales');

const T_LITERAL = /\bt\(\s*['"]([^'"]+)['"]/g;
// Template literals containing a dot-path prefix followed by ${…} count as
// potential i18n key generators, regardless of whether they sit inside `t()` —
// helpers like `sourceLabelKey(source) => \`console.source.${source}\`` are common.
const TEMPLATE_PREFIX = /`([a-zA-Z][\w.]*\.)[^`]*\$\{/g;

const walk = async (dir) => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'out') continue;
      out.push(...(await walk(full)));
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

const readAllSource = async (files) => {
  const chunks = await Promise.all(files.map((file) => readFile(file, 'utf8')));
  return chunks.join('\n');
};

const harvestExplicitKeys = (source) => {
  const literals = new Set();
  const prefixes = new Set();
  for (const match of source.matchAll(T_LITERAL)) literals.add(match[1]);
  for (const match of source.matchAll(TEMPLATE_PREFIX)) {
    const prefix = match[1].endsWith('.') ? match[1].slice(0, -1) : match[1];
    prefixes.add(prefix);
  }
  return { literals, prefixes };
};

const collectLocaleKeys = (obj, prefix, out) => {
  for (const [key, value] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      collectLocaleKeys(value, next, out);
    } else {
      out.add(next);
    }
  }
};

const readLocales = async () => {
  const out = {};
  for (const entry of await readdir(LOCALES_DIR)) {
    if (!entry.endsWith('.json')) continue;
    const raw = await readFile(path.join(LOCALES_DIR, entry), 'utf8');
    const keys = new Set();
    collectLocaleKeys(JSON.parse(raw), '', keys);
    out[entry.replace(/\.json$/, '')] = keys;
  }
  return out;
};

const main = async () => {
  const files = await walk(SRC_DIR);
  const source = await readAllSource(files);
  const { literals, prefixes } = harvestExplicitKeys(source);
  const locales = await readLocales();

  const isReferenced = (key) => {
    if (source.includes(`'${key}'`) || source.includes(`"${key}"`)) return true;
    for (const prefix of prefixes) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  };

  let missing = 0;
  let unused = 0;

  for (const [locale, keys] of Object.entries(locales)) {
    for (const key of literals) {
      if (!keys.has(key)) {
        console.warn(`[i18n] missing "${key}" in ${locale}`);
        missing++;
      }
    }
    for (const key of keys) {
      if (!isReferenced(key)) {
        console.warn(`[i18n] unused "${key}" in ${locale}`);
        unused++;
      }
    }
  }

  if (missing === 0 && unused === 0) {
    console.log('[i18n] clean');
    process.exit(0);
  }
  console.error(`[i18n] ${missing} missing, ${unused} unused`);
  process.exit((missing > 0 ? 1 : 0) + (unused > 0 ? 2 : 0));
};

main().catch((error) => {
  console.error('[i18n] linter crashed:', error);
  process.exit(4);
});
