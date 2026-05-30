import { flattenRemoteEntries } from '@main/services/bundle/manifestUtils';
import type { RemoteManifest, RemoteManifestEntry } from '@shared/contracts/bundle';
import { describe, expect, it } from 'vitest';

const file = (overrides: Partial<RemoteManifestEntry> & { path: string }): RemoteManifestEntry => ({
  name: overrides.path.split('/').at(-1) ?? overrides.path,
  size: 0,
  isDir: false,
  ...overrides,
});

describe('flattenRemoteEntries', () => {
  it('collects non-directory entries across every category, preserving order', () => {
    const manifest: RemoteManifest = {
      mods: [file({ path: 'mods', isDir: true }), file({ path: 'mods/a.jar', sha256: 'a' })],
      config: [file({ path: 'config/b.cfg' })],
    };

    expect(flattenRemoteEntries(manifest)).toEqual([
      file({ path: 'mods/a.jar', sha256: 'a' }),
      file({ path: 'config/b.cfg' }),
    ]);
  });

  it('returns an empty list for an empty manifest', () => {
    expect(flattenRemoteEntries({})).toEqual([]);
  });

  it('matches flattenRemote source iteration: keeps every non-dir entry regardless of sha256', () => {
    const manifest: RemoteManifest = {
      root: [
        file({ path: 'with-hash.jar', sha256: 'h' }),
        file({ path: 'without-hash.dat' }),
        file({ path: 'dir', isDir: true }),
      ],
    };

    const entries = flattenRemoteEntries(manifest);
    expect(entries.map((entry) => entry.path)).toEqual(['with-hash.jar', 'without-hash.dat']);
  });
});
