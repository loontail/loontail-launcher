import {
  type CatalogItem,
  catalogKeyFor,
  isLocal,
  isOfficial,
  localKey,
  officialKey,
  parseCatalogKey,
} from '@shared/contracts/catalog';
import { asCatalogKey, asClientSlug, asInstanceId } from '@shared/contracts/ids';
import { describe, expect, it } from 'vitest';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('catalog key composition', () => {
  it('builds source-namespaced keys', () => {
    expect(officialKey(asClientSlug('survival'))).toBe('official:survival');
    expect(localKey(asInstanceId(UUID))).toBe(`local:${UUID}`);
  });

  it('does not collide official and local builds sharing a name', () => {
    expect(officialKey(asClientSlug('vanilla'))).not.toBe(localKey(asInstanceId(UUID)));
  });

  it('derives the key from a ref', () => {
    expect(catalogKeyFor({ source: 'official', slug: asClientSlug('s') })).toBe('official:s');
    expect(catalogKeyFor({ source: 'local', id: asInstanceId(UUID) })).toBe(`local:${UUID}`);
  });
});

describe('parseCatalogKey', () => {
  it('round-trips an official key', () => {
    const ref = parseCatalogKey(officialKey(asClientSlug('survival')));
    expect(ref).toEqual({ source: 'official', slug: 'survival' });
  });

  it('round-trips a local key', () => {
    const ref = parseCatalogKey(localKey(asInstanceId(UUID)));
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
    expect(isLocal(official)).toBe(false);
    expect(isLocal(local)).toBe(true);
    expect(isOfficial(local)).toBe(false);
  });
});
