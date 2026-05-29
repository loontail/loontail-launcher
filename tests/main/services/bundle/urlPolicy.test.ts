import {
  resolveBundleManifestEntryUrl,
  resolveBundleRedirectUrl,
} from '@main/services/bundle/urlPolicy';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { describe, expect, it } from 'vitest';

const ENTRY_PATH = 'mods/example.jar';

describe('bundle URL policy', () => {
  describe('manifest entry URL normalization', () => {
    it('normalizes relative URLs against an HTTP localhost base', () => {
      expect(
        resolveBundleManifestEntryUrl(
          '/bundle/files/example.jar',
          'http://localhost:1337',
          ENTRY_PATH,
        ),
      ).toBe('http://localhost:1337/bundle/files/example.jar');
    });

    it('rejects plain HTTP asset URLs for remote production hosts', () => {
      expect(() =>
        resolveBundleManifestEntryUrl(
          'http://cdn.example.com/bundle/files/example.jar',
          'https://api.example.com',
          ENTRY_PATH,
        ),
      ).toThrowError(
        expect.objectContaining({
          code: BundleErrorCodes.MANIFEST_INVALID,
          message: expect.stringContaining('HTTP outside local/test hosts'),
        }),
      );
    });
  });

  describe('redirect validation', () => {
    it('accepts relative redirects within the original origin', () => {
      expect(
        resolveBundleRedirectUrl(
          '/bundle/files/example-v2.jar',
          'https://cdn.example.com/bundle/files/example.jar',
          'https://cdn.example.com/bundle/files/example.jar',
        ),
      ).toBe('https://cdn.example.com/bundle/files/example-v2.jar');
    });

    it('rejects HTTPS to HTTP redirect downgrades', () => {
      expect(() =>
        resolveBundleRedirectUrl(
          'http://cdn.example.test/bundle/files/example.jar',
          'https://cdn.example.test/bundle/files/example.jar',
          'https://cdn.example.test/bundle/files/example.jar',
        ),
      ).toThrowError(
        expect.objectContaining({
          code: BundleErrorCodes.DOWNLOAD_FAILED,
          message: expect.stringContaining('downgraded from HTTPS to HTTP'),
        }),
      );
    });

    it('rejects redirects to origins outside the manifest asset origin', () => {
      expect(() =>
        resolveBundleRedirectUrl(
          'https://other-cdn.example.com/bundle/files/example.jar',
          'https://cdn.example.com/bundle/files/example.jar',
          'https://cdn.example.com/bundle/files/example.jar',
        ),
      ).toThrowError(
        expect.objectContaining({
          code: BundleErrorCodes.DOWNLOAD_FAILED,
          message: expect.stringContaining('changed origin'),
        }),
      );
    });
  });
});
