import path from 'node:path';
import { bundleManifestPath, resolveSafeEntryPath } from '@main/services/bundle/paths';
import { describe, expect, it } from 'vitest';

const CLIENT = path.resolve('/tmp/clients/test-client');

describe('resolveSafeEntryPath', () => {
  it('resolves a normal relative path under the client folder', () => {
    expect(resolveSafeEntryPath(CLIENT, 'mods/foo.jar')).toBe(path.resolve(CLIENT, 'mods/foo.jar'));
  });

  it('rejects empty paths', () => {
    expect(() => resolveSafeEntryPath(CLIENT, '')).toThrow(/empty/i);
  });

  it('rejects absolute POSIX paths', () => {
    expect(() => resolveSafeEntryPath(CLIENT, '/etc/passwd')).toThrow(/absolute/i);
  });

  it('rejects Windows drive-letter absolute paths', () => {
    expect(() => resolveSafeEntryPath(CLIENT, 'C:\\Windows\\System32')).toThrow(/absolute/i);
  });

  it('rejects ../ escape attempts', () => {
    expect(() => resolveSafeEntryPath(CLIENT, '../../etc/passwd')).toThrow(/escapes/i);
  });

  it('rejects sneaky escape with embedded segment', () => {
    expect(() => resolveSafeEntryPath(CLIENT, 'mods/../../escape.txt')).toThrow(/escapes/i);
  });

  it('rejects the client folder itself', () => {
    expect(() => resolveSafeEntryPath(CLIENT, '.')).toThrow(/escapes/i);
  });
});

describe('bundleManifestPath', () => {
  it('places the manifest under .elixir/manifests/bundle.json', () => {
    expect(bundleManifestPath(CLIENT)).toBe(
      path.join(CLIENT, '.elixir', 'manifests', 'bundle.json'),
    );
  });
});
