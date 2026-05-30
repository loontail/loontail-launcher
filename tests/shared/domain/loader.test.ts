import { LoaderChoices } from '@shared/contracts/settings';
import { isLoaderAvailable, resolveLoader } from '@shared/domain/loader';
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
