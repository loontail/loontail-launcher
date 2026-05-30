import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  clearLocalManifest,
  loadLocalManifest,
  saveLocalManifest,
} from '@main/services/bundle/manifestRepo';
import { bundleManifestPath } from '@main/services/bundle/paths';
import type { LocalManifest } from '@shared/contracts/bundle';
import { asBundleSlug } from '@shared/contracts/ids';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const sample: LocalManifest = {
  bundleSlug: asBundleSlug('test-bundle'),
  manifestHash: 'abc123',
  syncedAt: '2025-01-01T00:00:00.000Z',
  files: {
    'mods/foo.jar': { sha256: 'deadbeef', size: 1024 },
  },
};

describe('ManifestRepository', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'bundle-mr-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns null when no manifest is present', async () => {
    expect(await loadLocalManifest(dir)).toBeNull();
  });

  it('round-trips a saved manifest', async () => {
    await saveLocalManifest(dir, sample);
    expect(await loadLocalManifest(dir)).toEqual(sample);
  });

  it('writes through .loontail/bundle.json', async () => {
    await saveLocalManifest(dir, sample);
    const fileExists = await fs
      .access(bundleManifestPath(dir))
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(true);
  });

  it('clearLocalManifest removes the file (idempotent on missing)', async () => {
    await saveLocalManifest(dir, sample);
    await clearLocalManifest(dir);
    expect(await loadLocalManifest(dir)).toBeNull();
    // Second clear must not throw.
    await clearLocalManifest(dir);
  });

  it('returns null for malformed JSON without throwing', async () => {
    const target = bundleManifestPath(dir);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '{not json');
    expect(await loadLocalManifest(dir)).toBeNull();
  });

  it('returns null when a top-level field is missing', async () => {
    const target = bundleManifestPath(dir);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify({ bundleSlug: 'x', manifestHash: 'h', files: {} }));
    expect(await loadLocalManifest(dir)).toBeNull();
  });

  it('returns null when a nested file entry has the wrong types', async () => {
    const target = bundleManifestPath(dir);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(
      target,
      JSON.stringify({
        bundleSlug: 'test-bundle',
        manifestHash: 'abc123',
        syncedAt: '2025-01-01T00:00:00.000Z',
        files: { 'mods/foo.jar': { sha256: 123, size: 'big' } },
      }),
    );
    expect(await loadLocalManifest(dir)).toBeNull();
  });
});
