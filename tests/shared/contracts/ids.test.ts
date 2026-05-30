import { BundleSlugSchema, asBundleSlug, asClientSlug } from '@shared/contracts/ids';
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
