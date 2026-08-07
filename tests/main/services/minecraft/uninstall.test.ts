import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SIDECAR_DIR } from '@main/constants/paths';
import { clearLocalManifest } from '@main/services/bundle/manifestRepo';
import type { MinecraftEnv } from '@main/services/minecraft/env';
import { isUnderClientsRoot, runUninstall } from '@main/services/minecraft/uninstall';
import { asCatalogKey } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Reject the recursive wipe of the client folder itself so runUninstall takes
// its residual-failure branch; everything else (unlink for the sidecars,
// readdir for the marker scan) delegates to the real fs.
const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const rmReject = vi.hoisted(() => ({ paths: new Set<string>() }));
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    default: {
      ...actual,
      rm: vi.fn((target: string, options?: Parameters<typeof actual.rm>[1]) => {
        if (typeof target === 'string' && rmReject.paths.has(target)) {
          return Promise.reject(new Error('EBUSY: resource busy or locked'));
        }
        return actual.rm(target, options);
      }),
    },
  };
});

// isUnderClientsRoot is the only guard before `fs.rm(folder, { recursive: true })`
// in runUninstall, so a regression here would be a P0 user-data-loss bug.
describe('isUnderClientsRoot', () => {
  describe('empty / blank inputs', () => {
    it('rejects an empty folder', () => {
      expect(isUnderClientsRoot('', '/clients')).toBe(false);
    });

    it('rejects an empty clientsRoot', () => {
      expect(isUnderClientsRoot('/clients/survival', '')).toBe(false);
    });

    it('rejects both empty', () => {
      expect(isUnderClientsRoot('', '')).toBe(false);
    });
  });

  describe('identity and parent', () => {
    it('rejects the root itself (relative is empty string)', () => {
      const root = path.resolve('/clients');
      expect(isUnderClientsRoot(root, root)).toBe(false);
    });

    it('rejects the parent of clientsRoot', () => {
      const root = path.resolve('/clients');
      const parent = path.resolve('/');
      expect(isUnderClientsRoot(parent, root)).toBe(false);
    });
  });

  describe('escapes', () => {
    it('rejects ".." segments that escape clientsRoot', () => {
      const root = path.resolve('/clients');
      const outside = path.join(root, '..', 'etc');
      expect(isUnderClientsRoot(outside, root)).toBe(false);
    });

    it('rejects a sibling directory of clientsRoot', () => {
      const root = path.resolve('/clients');
      const sibling = path.resolve('/other');
      expect(isUnderClientsRoot(sibling, root)).toBe(false);
    });
  });

  describe('absolute / drive-letter handling', () => {
    if (process.platform === 'win32') {
      it('rejects a folder on a different drive letter than clientsRoot', () => {
        expect(isUnderClientsRoot('D:\\survival', 'C:\\clients')).toBe(false);
      });

      it('accepts a child path on the same drive as clientsRoot', () => {
        expect(isUnderClientsRoot('C:\\clients\\survival', 'C:\\clients')).toBe(true);
      });
    } else {
      it('accepts a child path under clientsRoot', () => {
        expect(isUnderClientsRoot('/clients/survival', '/clients')).toBe(true);
      });
    }
  });

  describe('valid children', () => {
    it('accepts a direct child of clientsRoot', () => {
      const root = path.resolve('/clients');
      const child = path.join(root, 'survival');
      expect(isUnderClientsRoot(child, root)).toBe(true);
    });

    it('accepts a nested grandchild', () => {
      const root = path.resolve('/clients');
      const grand = path.join(root, 'survival', 'versions');
      expect(isUnderClientsRoot(grand, root)).toBe(true);
    });
  });
});

describe('runUninstall residual-failure path', () => {
  const KEY = asCatalogKey('official:residual');
  let clientsRoot: string;
  let folder: string;
  let sidecar: string;

  const makeEnv = (statuses: string[], overrides: Partial<MinecraftEnv> = {}): MinecraftEnv =>
    ({
      ops: { set: vi.fn(), delete: vi.fn() },
      forgeProcessorCache: { evictByDirectory: vi.fn() },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      emitStatus: (payload: { status: string }) => statuses.push(payload.status),
      emitError: vi.fn(),
      clearRuntimeOverride: vi.fn(),
      // The real bundle-manifest clear, injected: uninstall must reach it
      // through MinecraftEnv rather than a static minecraft -> bundle import.
      clearBundleManifest: clearLocalManifest,
      ...overrides,
    }) as unknown as MinecraftEnv;

  beforeEach(async () => {
    clientsRoot = await realFs.mkdtemp(path.join(os.tmpdir(), 'uninstall-residual-'));
    folder = path.join(clientsRoot, 'residual');
    sidecar = path.join(folder, SIDECAR_DIR, 'bundle.json');
    await realFs.mkdir(path.dirname(sidecar), { recursive: true });
    await realFs.writeFile(sidecar, '{"bundleSlug":"x"}', 'utf8');
    rmReject.paths.add(folder);
  });

  afterEach(async () => {
    rmReject.paths.clear();
    await realFs.rm(clientsRoot, { recursive: true, force: true });
  });

  it('clears the stale bundle sidecar when the folder wipe fails but markers are gone', async () => {
    const statuses: string[] = [];
    await runUninstall(makeEnv(statuses), KEY, folder, clientsRoot);

    await expect(fs.access(sidecar)).rejects.toThrow();
    expect(statuses).toContain(InstallStatuses.NOT_INSTALLED);
  });

  it('evicts only the uninstalled folder from the forge processor cache', async () => {
    // Wiping the whole cache discarded every other client's memoised install
    // plan, costing them an extra plan on their next repair (LM-14).
    const evictByDirectory = vi.fn();
    const env = makeEnv([], {
      forgeProcessorCache: { remember: vi.fn(), get: vi.fn(), evictByDirectory },
    });

    await runUninstall(env, KEY, folder, clientsRoot);

    expect(evictByDirectory).toHaveBeenCalledWith(folder);
  });
});
