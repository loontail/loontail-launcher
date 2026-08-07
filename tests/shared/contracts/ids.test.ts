import { localKey, officialKey, parseCatalogKey } from '@shared/contracts/catalog';
import {
  asBundleSlug,
  asClientSlug,
  asLocalBuildId,
  BundleSlugSchema,
  CatalogKeySchema,
} from '@shared/contracts/ids';
import { describe, expect, it } from 'vitest';

describe('BundleSlug brand', () => {
  it('round-trips a value through asBundleSlug', () => {
    expect(asBundleSlug('survival')).toBe('survival');
  });

  it('parses a non-empty string through BundleSlugSchema', () => {
    expect(BundleSlugSchema.parse('survival')).toBe('survival');
  });

  it('rejects an empty string', () => {
    expect(BundleSlugSchema.safeParse('').success).toBe(false);
  });

  it('keeps the BundleSlug and ClientSlug brands distinct', () => {
    const acceptBundleSlug = (slug: ReturnType<typeof asBundleSlug>) => slug;
    // @ts-expect-error a ClientSlug must not be assignable to a BundleSlug parameter
    acceptBundleSlug(asClientSlug('survival'));
    expect(acceptBundleSlug(asBundleSlug('survival'))).toBe('survival');
  });
});

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('CatalogKeySchema', () => {
  it('accepts an official key and a local key', () => {
    expect(CatalogKeySchema.parse('official:survival')).toBe('official:survival');
    expect(CatalogKeySchema.parse(`local:${UUID}`)).toBe(`local:${UUID}`);
  });

  it('rejects a bare slug and a bare uuid (the punned id keyspaces)', () => {
    expect(CatalogKeySchema.safeParse('survival').success).toBe(false);
    expect(CatalogKeySchema.safeParse(UUID).success).toBe(false);
  });

  it('rejects an empty string and an unknown namespace', () => {
    expect(CatalogKeySchema.safeParse('').success).toBe(false);
    expect(CatalogKeySchema.safeParse('official:').success).toBe(false);
    expect(CatalogKeySchema.safeParse('unknown:x').success).toBe(false);
  });

  it('round-trips through the composition helpers and parseCatalogKey', () => {
    const officialParsed = CatalogKeySchema.parse(officialKey(asClientSlug('survival')));
    expect(parseCatalogKey(officialParsed)).toEqual({ source: 'official', slug: 'survival' });
    const localParsed = CatalogKeySchema.parse(localKey(asLocalBuildId(UUID)));
    expect(parseCatalogKey(localParsed)).toEqual({ source: 'local', id: UUID });
  });
});
