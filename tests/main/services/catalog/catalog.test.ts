import { createCatalog } from '@main/services/catalog/catalog';
import { createOfficialCatalogSource } from '@main/services/catalog/officialSource';
import type { CatalogSource } from '@main/services/catalog/source';
import type { CatalogItem } from '@shared/contracts/catalog';
import type { Client } from '@shared/contracts/client';
import { describe, expect, it, vi } from 'vitest';

const officialItem = (slug: string, createdAt: string): CatalogItem =>
  ({
    kind: 'official',
    key: `official:${slug}`,
    ref: { source: 'official', slug },
    spec: { minecraftVersion: '1.21.4' },
    presentation: { createdAt, updatedAt: createdAt },
  }) as unknown as CatalogItem;

const localItem = (id: string, updatedAt: string): CatalogItem =>
  ({
    kind: 'local',
    key: `local:${id}`,
    ref: { source: 'local', id },
    spec: { minecraftVersion: '1.21.4' },
    presentation: { createdAt: updatedAt, updatedAt },
  }) as unknown as CatalogItem;

const source = (id: CatalogSource['id'], impl: Partial<CatalogSource>): CatalogSource => ({
  id,
  listItems: impl.listItems ?? (async () => []),
  getItem: impl.getItem ?? (async () => null),
});

describe('createCatalog.list', () => {
  it('merges items from all sources with local builds first', async () => {
    const local = source('local', {
      listItems: async () => [localItem('a', '2026-01-01T00:00:00.000Z')],
    });
    const official = source('official', {
      listItems: async () => [
        officialItem('old', '2025-01-01T00:00:00.000Z'),
        officialItem('new', '2026-06-01T00:00:00.000Z'),
      ],
    });
    const result = await createCatalog([local, official]).list();
    expect(result.items.map((item) => item.key)).toEqual([
      'local:a',
      'official:new',
      'official:old',
    ]);
    expect(result.sources).toEqual([
      { id: 'local', ok: true },
      { id: 'official', ok: true },
    ]);
  });

  it('never blanks local builds when the official source rejects (CMS down)', async () => {
    const local = source('local', {
      listItems: async () => [localItem('a', '2026-01-01T00:00:00.000Z')],
    });
    const official = source('official', {
      listItems: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const result = await createCatalog([local, official]).list();
    expect(result.items.map((item) => item.key)).toEqual(['local:a']);
    expect(result.sources).toContainEqual({ id: 'official', ok: false });
    expect(result.sources).toContainEqual({ id: 'local', ok: true });
  });
});

describe('createCatalog.resolve', () => {
  it('dispatches to the source matching the ref', async () => {
    const getLocal = vi.fn(async () => localItem('a', '2026-01-01T00:00:00.000Z'));
    const getOfficial = vi.fn(async () => officialItem('x', '2026-01-01T00:00:00.000Z'));
    const catalog = createCatalog([
      source('local', { getItem: getLocal }),
      source('official', { getItem: getOfficial }),
    ]);
    await catalog.resolve({ source: 'local', id: 'a' } as never);
    expect(getLocal).toHaveBeenCalledOnce();
    expect(getOfficial).not.toHaveBeenCalled();
  });

  it('returns null when no source matches the ref', async () => {
    const catalog = createCatalog([source('official', {})]);
    expect(await catalog.resolve({ source: 'local', id: 'a' } as never)).toBeNull();
  });
});

describe('createCatalog.resolveBuildByKey', () => {
  it('resolves a local key offline even when the official source rejects', async () => {
    const local = source('local', {
      getItem: async (ref) =>
        ref.source === 'local' && ref.id === 'uuid'
          ? localItem('uuid', '2026-01-01T00:00:00.000Z')
          : null,
    });
    const official = source('official', {
      getItem: async () => {
        throw new Error('CMS down');
      },
    });
    const item = await createCatalog([local, official]).resolveBuildByKey('local:uuid' as never);
    expect(item?.kind).toBe('local');
  });

  it('resolves an official key from the official source', async () => {
    const local = source('local', { getItem: async () => null });
    const official = source('official', {
      getItem: async (ref) =>
        ref.source === 'official' ? officialItem('survival', '2026-01-01T00:00:00.000Z') : null,
    });
    const item = await createCatalog([local, official]).resolveBuildByKey(
      'official:survival' as never,
    );
    expect(item?.kind).toBe('official');
  });

  it('resolves null for a malformed key without touching a source', async () => {
    const getLocal = vi.fn(async () => null);
    const catalog = createCatalog([source('local', { getItem: getLocal })]);
    expect(await catalog.resolveBuildByKey('garbage' as never)).toBeNull();
    expect(getLocal).not.toHaveBeenCalled();
  });
});

const fakeClient = (slug: string): Client =>
  ({
    id: slug,
    slug,
    title: slug,
    shortDescription: '',
    description: '',
    available: true,
    minecraftVersion: '1.21.4',
    forgeVersion: null,
    fabricVersion: null,
    runtimeVersion: null,
    bundleSlug: null,
    poster: { url: 'cache://poster', width: null, height: null },
    background: { url: 'cache://bg', width: null, height: null },
    titleImage: null,
    screenshots: [],
    keywords: [],
    servers: [],
  }) as unknown as Client;

describe('OfficialCatalogSource', () => {
  it('maps clients to official catalog items', async () => {
    const src = createOfficialCatalogSource({
      listClients: async () => [fakeClient('survival')],
    });
    const items = await src.listItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('official');
    expect(items[0]?.key).toBe('official:survival');
    expect(items[0]?.spec.minecraftVersion).toBe('1.21.4');
  });

  it('getItem finds an official build by slug and returns null when absent', async () => {
    const src = createOfficialCatalogSource({
      listClients: async () => [fakeClient('survival')],
    });
    expect(await src.getItem({ source: 'official', slug: 'survival' as never })).not.toBeNull();
    expect(await src.getItem({ source: 'official', slug: 'missing' as never })).toBeNull();
    expect(await src.getItem({ source: 'local', id: 'x' as never })).toBeNull();
  });

  it('propagates a fetch rejection so the aggregator can mark it degraded', async () => {
    const src = createOfficialCatalogSource({
      listClients: async () => {
        throw new Error('offline');
      },
    });
    await expect(src.listItems()).rejects.toThrow('offline');
  });
});
