import { LoaderChoices } from '@shared/contracts/settings';
import {
  canChooseLoader,
  isLoaderAmbiguous,
  isLoaderAvailable,
  resolveLoader,
} from '@shared/domain/loader';
import { describe, expect, it } from 'vitest';

describe('isLoaderAvailable', () => {
  it('requires the matching version field for forge and fabric', () => {
    expect(isLoaderAvailable({ forgeVersion: '47.2.0' }, LoaderChoices.FORGE)).toBe(true);
    expect(isLoaderAvailable({ forgeVersion: null }, LoaderChoices.FORGE)).toBe(false);
    expect(isLoaderAvailable({ fabricVersion: '0.15.0' }, LoaderChoices.FABRIC)).toBe(true);
    expect(isLoaderAvailable({}, LoaderChoices.FABRIC)).toBe(false);
  });

  it('always permits vanilla', () => {
    expect(isLoaderAvailable({}, LoaderChoices.VANILLA)).toBe(true);
    expect(
      isLoaderAvailable({ forgeVersion: 'x', fabricVersion: 'y' }, LoaderChoices.VANILLA),
    ).toBe(true);
  });
});

describe('resolveLoader', () => {
  it('honours a valid override', () => {
    expect(resolveLoader({ forgeVersion: '47.2.0' }, LoaderChoices.FORGE)).toEqual({
      kind: 'resolved',
      loader: LoaderChoices.FORGE,
    });
  });

  it('lets a vanilla override win over an otherwise ambiguous client', () => {
    expect(resolveLoader({ forgeVersion: 'x', fabricVersion: 'y' }, LoaderChoices.VANILLA)).toEqual(
      { kind: 'resolved', loader: LoaderChoices.VANILLA },
    );
  });

  it('drops an override whose loader version field is absent', () => {
    expect(resolveLoader({ fabricVersion: '0.15.0' }, LoaderChoices.FORGE)).toEqual({
      kind: 'resolved',
      loader: LoaderChoices.FABRIC,
    });
  });

  it('reports ambiguity when both forge and fabric are available and no override applies', () => {
    expect(resolveLoader({ forgeVersion: 'x', fabricVersion: 'y' }, null)).toEqual({
      kind: 'ambiguous',
    });
  });

  it('derives a single available loader without an override', () => {
    expect(resolveLoader({ forgeVersion: 'x' }, null)).toEqual({
      kind: 'resolved',
      loader: LoaderChoices.FORGE,
    });
    expect(resolveLoader({ fabricVersion: 'y' }, null)).toEqual({
      kind: 'resolved',
      loader: LoaderChoices.FABRIC,
    });
  });

  it('falls back to vanilla when no loader is available', () => {
    expect(resolveLoader({}, null)).toEqual({ kind: 'resolved', loader: LoaderChoices.VANILLA });
  });
});

describe('isLoaderAmbiguous', () => {
  it('is true for forge+fabric with no override', () => {
    expect(isLoaderAmbiguous({ forgeVersion: 'x', fabricVersion: 'y' }, null)).toBe(true);
  });

  it('is false once a valid override applies', () => {
    expect(isLoaderAmbiguous({ forgeVersion: 'x', fabricVersion: 'y' }, LoaderChoices.FORGE)).toBe(
      false,
    );
  });

  it('is false for a single-loader build', () => {
    expect(isLoaderAmbiguous({ forgeVersion: 'x' }, null)).toBe(false);
    expect(isLoaderAmbiguous({ fabricVersion: 'y' }, null)).toBe(false);
    expect(isLoaderAmbiguous({}, null)).toBe(false);
  });
});

describe('canChooseLoader', () => {
  it('requires more than one non-vanilla loader', () => {
    expect(canChooseLoader({ forgeVersion: 'x', fabricVersion: 'y' })).toBe(true);
    expect(canChooseLoader({ forgeVersion: 'x' })).toBe(false);
    expect(canChooseLoader({ fabricVersion: 'y' })).toBe(false);
    expect(canChooseLoader({})).toBe(false);
  });
});
