import type { LocalManifest } from '@shared/contracts/bundle';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ownershipMocks = vi.hoisted(() => ({ loadLocalManifest: vi.fn() }));

vi.mock('@main/services/bundle/manifestRepo', () => ({
  loadLocalManifest: ownershipMocks.loadLocalManifest,
}));

import {
  bundleOwnedRelativePaths,
  createBundleRepairIssueFilter,
  resolveBundleRepairFilter,
  toBundleKey,
} from '@main/services/bundle/ownership';

const CLIENT_FOLDER = 'Z:/clients/test-client';

const manifest = (bundleSlug: string, files: string[]): LocalManifest =>
  ({
    bundleSlug,
    manifestHash: 'a'.repeat(64),
    syncedAt: new Date().toISOString(),
    files: Object.fromEntries(files.map((f) => [f, { sha256: 'x', size: 1 }])),
  }) as unknown as LocalManifest;

beforeEach(() => {
  ownershipMocks.loadLocalManifest.mockReset();
});

describe('bundleOwnedRelativePaths', () => {
  it('returns the manifest file keys when the bundle slug matches', async () => {
    ownershipMocks.loadLocalManifest.mockResolvedValue(
      manifest('pack-a', ['mods/a.jar', 'config/b.toml']),
    );

    const owned = await bundleOwnedRelativePaths(CLIENT_FOLDER, 'pack-a');

    expect(owned).not.toBeNull();
    expect([...(owned as ReadonlySet<string>)].sort()).toEqual(['config/b.toml', 'mods/a.jar']);
  });

  it('returns null when the local manifest belongs to a different bundle', async () => {
    ownershipMocks.loadLocalManifest.mockResolvedValue(manifest('other-pack', ['mods/a.jar']));

    expect(await bundleOwnedRelativePaths(CLIENT_FOLDER, 'pack-a')).toBeNull();
  });

  it('returns null when there is no local manifest', async () => {
    ownershipMocks.loadLocalManifest.mockResolvedValue(null);

    expect(await bundleOwnedRelativePaths(CLIENT_FOLDER, 'pack-a')).toBeNull();
  });
});

describe('createBundleRepairIssueFilter', () => {
  it('skips bundle-owned issue paths and keeps the rest', () => {
    const filter = createBundleRepairIssueFilter(CLIENT_FOLDER, new Set(['mods/a.jar']));
    const owned = `${CLIENT_FOLDER}/mods/a.jar`;
    const vanilla = `${CLIENT_FOLDER}/versions/1.21/1.21.jar`;

    expect(filter({ issue: { path: owned } } as never)).toBe(false);
    expect(filter({ issue: { path: vanilla } } as never)).toBe(true);
  });
});

describe('toBundleKey', () => {
  it('normalizes an absolute path to a forward-slash manifest key', () => {
    expect(toBundleKey(CLIENT_FOLDER, `${CLIENT_FOLDER}/mods/a.jar`)).toBe('mods/a.jar');
  });
});

describe('resolveBundleRepairFilter', () => {
  it('returns a filter that skips owned paths when the bundle matches', async () => {
    ownershipMocks.loadLocalManifest.mockResolvedValue(manifest('pack-a', ['mods/a.jar']));

    const filter = await resolveBundleRepairFilter(CLIENT_FOLDER, 'pack-a');

    expect(filter).not.toBeNull();
    const applied = (filter as NonNullable<typeof filter>)({
      issue: { path: `${CLIENT_FOLDER}/mods/a.jar` },
    } as never);
    expect(applied).toBe(false);
  });

  it('returns null when nothing is owned (no manifest)', async () => {
    ownershipMocks.loadLocalManifest.mockResolvedValue(null);

    expect(await resolveBundleRepairFilter(CLIENT_FOLDER, 'pack-a')).toBeNull();
  });
});
