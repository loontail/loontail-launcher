import { describe, expect, it, vi } from 'vitest';

vi.mock('@main/config', () => ({
  mainConfig: { apiUrl: 'https://api.example.com' },
}));

import {
  classifyUrl,
  enforceTransport,
  isLocalOrTestHost,
  isTransportDowngrade,
  trustOf,
} from '@main/infra/originPolicy';

describe('origin policy', () => {
  describe('classifyUrl', () => {
    it('grants api trust to the configured origin only', () => {
      expect(trustOf('https://api.example.com/x')).toBe('api');
      expect(trustOf('https://api.example.com:443/x')).toBe('api');
      // A different scheme or port is a different origin, so not the API.
      expect(trustOf('http://api.example.com/x')).toBe(null);
      expect(trustOf('https://api.example.com:8443/x')).toBe(null);
    });

    it('never grants api trust through the public-host or local carve-outs', () => {
      expect(
        trustOf('http://textures.minecraft.net/t/a', { publicHosts: ['textures.minecraft.net'] }),
      ).toBe('public');
      expect(trustOf('http://127.0.0.1:6543/internal', { allowLocalHosts: true })).toBe('public');
    });

    it('matches public hosts exactly, not by suffix', () => {
      const policy = { publicHosts: ['textures.minecraft.net'] };
      expect(trustOf('https://textures.minecraft.net.evil.example.com/a', policy)).toBe(null);
      expect(trustOf('https://sub.textures.minecraft.net/a', policy)).toBe(null);
    });

    it('refuses local hosts unless the call site opted in', () => {
      expect(trustOf('http://127.0.0.1:6543/internal')).toBe(null);
      expect(trustOf('https://other.test.invalid/x')).toBe(null);
    });

    it('reports why a URL was refused so callers can map it to their own error copy', () => {
      expect(classifyUrl('not-a-url')).toEqual({ trust: null, reason: 'invalid-url' });
      expect(classifyUrl('file:///etc/passwd')).toEqual({
        trust: null,
        reason: 'unsupported-scheme',
      });
      expect(classifyUrl('data:text/html,x')).toEqual({
        trust: null,
        reason: 'unsupported-scheme',
      });
      expect(classifyUrl('http://cdn.example.com/x')).toEqual({
        trust: null,
        reason: 'insecure-transport',
      });
      expect(classifyUrl('https://cdn.example.com/x')).toEqual({
        trust: null,
        reason: 'untrusted-host',
      });
    });
  });

  describe('isLocalOrTestHost', () => {
    it('covers the documented local/test set, case-insensitively and de-bracketed', () => {
      for (const host of ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]', 'LOCALHOST']) {
        expect(isLocalOrTestHost(host)).toBe(true);
      }
      for (const host of ['app.localhost', 'x.test', 'y.invalid']) {
        expect(isLocalOrTestHost(host)).toBe(true);
      }
      expect(isLocalOrTestHost('example.com')).toBe(false);
      expect(isLocalOrTestHost('nottest')).toBe(false);
    });
  });

  describe('enforceTransport', () => {
    it('upgrades plaintext for remote hosts and leaves local hosts alone', () => {
      expect(enforceTransport('http://textures.minecraft.net/t/a')).toBe(
        'https://textures.minecraft.net/t/a',
      );
      expect(enforceTransport('http://localhost:8080/x')).toBe('http://localhost:8080/x');
      expect(enforceTransport('https://api.example.com/x')).toBe('https://api.example.com/x');
      expect(enforceTransport('not-a-url')).toBe('not-a-url');
    });
  });

  describe('isTransportDowngrade', () => {
    it('only flags https -> http', () => {
      expect(
        isTransportDowngrade(new URL('https://a.example.com'), new URL('http://a.example.com')),
      ).toBe(true);
      expect(
        isTransportDowngrade(new URL('http://a.example.com'), new URL('http://a.example.com')),
      ).toBe(false);
      expect(
        isTransportDowngrade(new URL('http://a.example.com'), new URL('https://a.example.com')),
      ).toBe(false);
    });
  });
});
