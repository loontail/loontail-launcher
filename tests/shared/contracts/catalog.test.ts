import {
  type CatalogItem,
  isOfficial,
  localKey,
  officialKey,
  parseCatalogKey,
} from '@shared/contracts/catalog';
import { asCatalogKey, asClientSlug, asLocalBuildId } from '@shared/contracts/ids';
import { describe, expect, it } from 'vitest';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('catalog key composition', () => {
  it('builds source-namespaced keys', () => {
    expect(officialKey(asClientSlug('survival'))).toBe('official:survival');
    expect(localKey(asLocalBuildId(UUID))).toBe(`local:${UUID}`);
  });

  it('does not collide official and local builds sharing a name', () => {
    expect(officialKey(asClientSlug('vanilla'))).not.toBe(localKey(asLocalBuildId(UUID)));
  });
});

describe('parseCatalogKey', () => {
  it('round-trips an official key', () => {
    const ref = parseCatalogKey(officialKey(asClientSlug('survival')));
    expect(ref).toEqual({ source: 'official', slug: 'survival' });
  });

  it('round-trips a local key', () => {
    const ref = parseCatalogKey(localKey(asLocalBuildId(UUID)));
    expect(ref).toEqual({ source: 'local', id: UUID });
  });

  it('keeps a slug that itself contains a colon intact', () => {
    const ref = parseCatalogKey(asCatalogKey('official:weird:slug'));
    expect(ref).toEqual({ source: 'official', slug: 'weird:slug' });
  });

  it('returns null for malformed keys', () => {
    expect(parseCatalogKey(asCatalogKey('garbage'))).toBeNull();
    expect(parseCatalogKey(asCatalogKey('official:'))).toBeNull();
    expect(parseCatalogKey(asCatalogKey(':value'))).toBeNull();
    expect(parseCatalogKey(asCatalogKey('unknown:x'))).toBeNull();
  });
});

describe('catalog item guards', () => {
  const official = { kind: 'official' } as unknown as CatalogItem;
  const local = { kind: 'local' } as unknown as CatalogItem;

  it('narrows by kind', () => {
    expect(isOfficial(official)).toBe(true);
    expect(isOfficial(local)).toBe(false);
  });
});
