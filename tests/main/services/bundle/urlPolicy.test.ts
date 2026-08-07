import { describe, expect, it, vi } from 'vitest';

// The host-pin is enforced against the configured API origin, so the URL policy
// now depends on mainConfig. Pin it to api.example.com so the existing
// cdn.example.com fixtures exercise the non-API-host rejection path.
vi.mock('@main/config', () => ({
  mainConfig: { apiUrl: 'https://api.example.com' },
}));

import {
  bundleAssetTrust,
  resolveBundleManifestEntryUrl,
  resolveBundleRedirectUrl,
  validateBundleAssetDownloadUrl,
} from '@main/services/bundle/urlPolicy';
import { BundleErrorCodes } from '@shared/contracts/bundle';

const ENTRY_PATH = 'mods/example.jar';

describe('bundle URL policy', () => {
  describe('manifest entry URL normalization', () => {
    it('normalizes relative URLs against an HTTP localhost base', () => {
      expect(
        resolveBundleManifestEntryUrl(
          '/bundle/files/example.jar',
          'http://localhost:8080',
          ENTRY_PATH,
        ),
      ).toBe('http://localhost:8080/bundle/files/example.jar');
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
          'https://api.example.com/bundle/files/example.jar',
          'https://api.example.com/bundle/files/example.jar',
        ),
      ).toBe('https://api.example.com/bundle/files/example-v2.jar');
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
          'https://other.example.test/bundle/files/example.jar',
          'https://api.example.com/bundle/files/example.jar',
          'https://api.example.com/bundle/files/example.jar',
        ),
      ).toThrowError(
        expect.objectContaining({
          code: BundleErrorCodes.DOWNLOAD_FAILED,
          message: expect.stringContaining('changed origin'),
        }),
      );
    });

    it('rejects a redirect hop onto a host the policy does not allow at all', () => {
      expect(() =>
        resolveBundleRedirectUrl(
          'https://cdn.example.com/bundle/files/example.jar',
          'https://api.example.com/bundle/files/example.jar',
          'https://api.example.com/bundle/files/example.jar',
        ),
      ).toThrowError(
        expect.objectContaining({
          code: BundleErrorCodes.DOWNLOAD_FAILED,
          message: expect.stringContaining('not the API origin'),
        }),
      );
    });
  });

  describe('host pinning to the API origin', () => {
    it('accepts an absolute asset URL on the API origin', () => {
      expect(
        resolveBundleManifestEntryUrl(
          'https://api.example.com/bundle-registry/builds/x/files/example.jar',
          'https://api.example.com',
          ENTRY_PATH,
        ),
      ).toBe('https://api.example.com/bundle-registry/builds/x/files/example.jar');
    });

    it('rejects an HTTPS asset URL on a non-API host', () => {
      expect(() =>
        resolveBundleManifestEntryUrl(
          'https://cdn.example.com/bundle/files/example.jar',
          'https://api.example.com',
          ENTRY_PATH,
        ),
      ).toThrowError(
        expect.objectContaining({
          code: BundleErrorCodes.MANIFEST_INVALID,
          message: expect.stringContaining('not the API origin'),
        }),
      );
    });

    it('rejects a download URL on a non-API host', () => {
      expect(() => validateBundleAssetDownloadUrl('https://evil.example.com/x.jar')).toThrowError(
        expect.objectContaining({
          code: BundleErrorCodes.DOWNLOAD_FAILED,
          message: expect.stringContaining('not the API origin'),
        }),
      );
    });

    it('grants the bearer to the API origin only; local/test hosts stay reachable but bare', () => {
      expect(bundleAssetTrust('https://api.example.com/x.jar')).toBe('api');
      // A crafted manifest entry can name any local/test host. It downloads, but
      // as `public` it must never carry the session bearer.
      expect(bundleAssetTrust('http://localhost:8080/x.jar')).toBe('public');
      expect(bundleAssetTrust('https://anything.test/x.jar')).toBe('public');
      expect(bundleAssetTrust('https://cdn.example.com/x.jar')).toBe(null);
      expect(bundleAssetTrust('not-a-url')).toBe(null);
    });
  });
});
