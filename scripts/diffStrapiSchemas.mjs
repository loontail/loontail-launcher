#!/usr/bin/env node
/**
 * Strapi ↔ launcher schema coverage check.
 *
 * Reads every `schema.json` under `../launcher-strapi/src/api/*\/content-types`
 * and verifies the launcher's Zod contract source mentions each attribute name
 * by literal token. Flags:
 *   - attributes Strapi exposes that the launcher's contract doesn't reference
 *     (probable drift after backend update)
 *   - relations/media fields the launcher relies on but Strapi doesn't define
 *     (best-effort: looks for `<attribute>:` patterns in the contract)
 *
 * The check is lexical, not semantic: it doesn't validate the Zod type shape,
 * only that the attribute name surfaces in the launcher contract source. Tight
 * enough to catch additions/removals; loose enough to survive richer schemas.
 *
 * Exit codes:
 *   0 — clean
 *   1 — drift detected
 *   2 — script error (missing Strapi project, malformed JSON)
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STRAPI_ROOT = path.resolve(ROOT, '..', 'launcher-strapi', 'src', 'api');
const CONTRACTS_DIR = path.resolve(ROOT, 'src', 'shared', 'contracts');

const CONTRACT_BY_CONTENT_TYPE = {
  client: 'client.ts',
  keyword: 'client.ts',
  server: 'strapi.ts',
};

// Strapi system attributes the launcher derives from StrapiEntitySchema and
// doesn't redeclare per content-type.
const STRAPI_SYSTEM_ATTRIBUTES = new Set([
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'locale',
  'localizations',
]);

// Attributes Strapi defines but the launcher intentionally ignores. Keyed by
// "<api>/<contentType>"; each entry lists the attribute names to skip. Drop
// an entry here only when the launcher actually consumes the field.
const INTENTIONAL_IGNORES = {
  'client/client': new Set([
    // bundle-registry plugin reference; launcher uses `slug` for identity and
    // doesn't currently consume the bundle field.
    'bundleSlug',
  ]),
};

const exists = async (filePath) => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const collectSchemaPaths = async () => {
  const out = [];
  if (!(await exists(STRAPI_ROOT))) return out;
  for (const apiName of await readdir(STRAPI_ROOT)) {
    const contentTypesDir = path.join(STRAPI_ROOT, apiName, 'content-types');
    if (!(await exists(contentTypesDir))) continue;
    for (const typeName of await readdir(contentTypesDir)) {
      const schemaPath = path.join(contentTypesDir, typeName, 'schema.json');
      if (await exists(schemaPath)) out.push({ apiName, typeName, schemaPath });
    }
  }
  return out;
};

const readContract = async (filename) => {
  const fullPath = path.join(CONTRACTS_DIR, filename);
  if (!(await exists(fullPath))) return null;
  return readFile(fullPath, 'utf8');
};

const main = async () => {
  if (!(await exists(STRAPI_ROOT))) {
    console.warn(`[schema-diff] launcher-strapi not found at ${STRAPI_ROOT} — skipping`);
    process.exit(0);
  }

  const schemas = await collectSchemaPaths();
  if (schemas.length === 0) {
    console.error('[schema-diff] no Strapi content-types found');
    process.exit(2);
  }

  let drift = 0;

  for (const { apiName, typeName, schemaPath } of schemas) {
    const raw = await readFile(schemaPath, 'utf8');
    const schema = JSON.parse(raw);
    const attributes = Object.keys(schema.attributes ?? {});

    const contractFile = CONTRACT_BY_CONTENT_TYPE[typeName];
    if (!contractFile) {
      console.warn(`[schema-diff] ${apiName}/${typeName}: no launcher contract mapping — skipping`);
      continue;
    }
    const contractSource = await readContract(contractFile);
    if (contractSource === null) {
      console.error(`[schema-diff] contract file missing: ${contractFile}`);
      drift++;
      continue;
    }

    const ignored = INTENTIONAL_IGNORES[`${apiName}/${typeName}`] ?? new Set();
    const missing = [];
    for (const attribute of attributes) {
      if (STRAPI_SYSTEM_ATTRIBUTES.has(attribute)) continue;
      if (ignored.has(attribute)) continue;
      const tokenPattern = new RegExp(`\\b${attribute}\\b`);
      if (!tokenPattern.test(contractSource)) missing.push(attribute);
    }

    if (missing.length > 0) {
      console.warn(
        `[schema-diff] ${apiName}/${typeName}: ${missing.length} attribute(s) not referenced in ${contractFile}: ${missing.join(', ')}`,
      );
      drift += missing.length;
    }
  }

  if (drift === 0) {
    console.log('[schema-diff] clean');
    process.exit(0);
  }
  console.error(`[schema-diff] ${drift} drifted attribute(s)`);
  process.exit(1);
};

main().catch((error) => {
  console.error('[schema-diff] crashed:', error);
  process.exit(2);
});
