import { createLocalCatalogSource } from '@main/services/localBuilds/localSource';
import type { LocalBuildManifest, LocalBuildRegistryEntry } from '@shared/contracts/localBuild';
import { LocalBuildManifestSchema } from '@shared/contracts/localBuild';
import { describe, expect, it } from 'vitest';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const DIR = `Z:/clients/${UUID}`;

const manifest = (overrides: Record<string, unknown> = {}): LocalBuildManifest =>
  LocalBuildManifestSchema.parse({
    schema: 1,
    id: UUID,
    name: 'My Fabric Pack',
    minecraftVersion: '1.21.4',
    loader: { type: 'fabric', version: '0.16.9' },
    createdAt: '2026-06-07T12:00:00.000Z',
    updatedAt: '2026-06-07T12:00:00.000Z',
    ...overrides,
  });

const entry: LocalBuildRegistryEntry = {
  id: UUID as LocalBuildRegistryEntry['id'],
  name: 'My Fabric Pack',
  dir: DIR,
  updatedAt: '2026-06-07T12:00:00.000Z',
};

const sourceWith = (loaded: LocalBuildManifest | null) =>
  createLocalCatalogSource({
    listEntries: () => [entry],
    getEntry: (ref) => (ref.source === 'local' && ref.id === entry.id ? entry : undefined),
    loadManifest: async () => loaded,
  });

describe('LocalCatalogSource mapping', () => {
  it('projects a fabric local build into a local catalog item', async () => {
    const [item] = await sourceWith(manifest()).listItems();
    expect(item?.kind).toBe('local');
    expect(item?.key).toBe(`local:${UUID}`);
    expect(item?.spec.fabricVersion).toBe('0.16.9');
    expect(item?.spec.forgeVersion).toBeNull();
    expect(item?.spec.bundleSlug).toBeNull();
    expect(item?.presentation.title).toBe('My Fabric Pack');
    expect(item?.presentation.available).toBe(true);
  });

  it('maps a forge local build loader version onto forgeVersion only', async () => {
    const [item] = await sourceWith(
      manifest({ loader: { type: 'forge', version: '47.3.0' } }),
    ).listItems();
    expect(item?.spec.forgeVersion).toBe('47.3.0');
    expect(item?.spec.fabricVersion).toBeNull();
  });

  it('carries a remote bundle reference into the spec', async () => {
    const [item] = await sourceWith(
      manifest({
        bundle: { source: 'remote', bundleSlug: 'survival', manifestUrl: 'https://x/m.json' },
      }),
    ).listItems();
    expect(item?.spec.bundleSlug).toBe('survival');
  });

  it('skips a local build whose manifest cannot be loaded', async () => {
    expect(await sourceWith(null).listItems()).toEqual([]);
  });
});

describe('LocalCatalogSource.getItem', () => {
  it('resolves a local ref from disk', async () => {
    const item = await sourceWith(manifest()).getItem({ source: 'local', id: entry.id });
    expect(item?.kind).toBe('local');
  });

  it('returns null for a non-local ref', async () => {
    const item = await sourceWith(manifest()).getItem({
      source: 'official',
      slug: 'survival' as never,
    });
    expect(item).toBeNull();
  });

  it('returns null when the manifest is unreadable', async () => {
    const item = await sourceWith(null).getItem({ source: 'local', id: entry.id });
    expect(item).toBeNull();
  });
});
