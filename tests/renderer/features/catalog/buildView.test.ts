import {
  buildInitial,
  fallbackHue,
  loaderVersionFor,
  primaryLoader,
} from '@renderer/features/catalog/buildView';
import type { CatalogItem } from '@shared/contracts/catalog';
import { describe, expect, it } from 'vitest';

const official = (overrides: Record<string, unknown> = {}): CatalogItem =>
  ({
    kind: 'official',
    key: 'official:survival',
    ref: { source: 'official', key: 'survival' },
    spec: { minecraftVersion: '1.21.4', forgeVersion: null, fabricVersion: null },
    presentation: { title: 'Survival' },
    raw: { poster: { url: 'p' }, background: { url: 'b' }, screenshots: [] },
    ...overrides,
  }) as unknown as CatalogItem;

const local = (media: Record<string, unknown> = {}): CatalogItem =>
  ({
    kind: 'local',
    key: 'local:550e8400-e29b-41d4-a716-446655440000',
    ref: { source: 'local', id: '550e8400-e29b-41d4-a716-446655440000' },
    spec: { minecraftVersion: '1.21.4', forgeVersion: null, fabricVersion: null },
    presentation: {
      title: 'my world',
      media: { poster: null, background: null, screenshots: [], ...media },
    },
  }) as unknown as CatalogItem;

describe('primaryLoader / loaderVersionFor', () => {
  it('picks fabric when only fabric is present', () => {
    const item = official({ spec: { minecraftVersion: '1.21.4', fabricVersion: '0.16.9' } });
    expect(primaryLoader(item)).toBe('fabric');
    expect(loaderVersionFor(item)).toBe('0.16.9');
  });

  it('picks forge when only forge is present', () => {
    const item = official({ spec: { minecraftVersion: '1.21.4', forgeVersion: '47.3.0' } });
    expect(primaryLoader(item)).toBe('forge');
    expect(loaderVersionFor(item)).toBe('47.3.0');
  });

  it('prefers forge when both are present (loader chosen at install)', () => {
    const item = official({
      spec: { minecraftVersion: '1.21.4', forgeVersion: '47.3.0', fabricVersion: '0.16.9' },
    });
    expect(primaryLoader(item)).toBe('forge');
  });

  it('falls back to vanilla with no loader version', () => {
    const item = official({ spec: { minecraftVersion: '1.21.4' } });
    expect(primaryLoader(item)).toBe('vanilla');
    expect(loaderVersionFor(item)).toBeNull();
  });
});

describe('fallbackHue', () => {
  it('is deterministic per build key and within [0,360)', () => {
    const item = local();
    const hue = fallbackHue(item);
    expect(hue).toBe(fallbackHue(item));
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });

  it('differs for different keys', () => {
    expect(fallbackHue(official())).not.toBe(fallbackHue(local()));
  });
});

describe('buildInitial', () => {
  it('returns the uppercased first character of the title', () => {
    expect(buildInitial(local())).toBe('M');
  });

  it('returns a placeholder for an empty title', () => {
    expect(buildInitial(local({}) as CatalogItem)).toBe('M');
    const blank = {
      ...local(),
      presentation: { title: '   ', media: {} },
    } as unknown as CatalogItem;
    expect(buildInitial(blank)).toBe('?');
  });
});
