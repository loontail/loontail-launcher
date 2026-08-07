import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const managerMocks = vi.hoisted(() => {
  return {
    fetchRemoteManifest: vi.fn(),
    getClient: vi.fn(),
    getSettings: vi.fn(),
  };
});

import { BundleError } from '@main/services/bundle/errors';
import { BundleManager } from '@main/services/bundle/manager';
import { bundleManifestPath } from '@main/services/bundle/paths';
import type { ActiveSync } from '@main/services/bundle/syncState';
import { createClientOperationLocks } from '@main/services/clientOperationLocks';
import {
  BundleErrorCodes,
  BundleSyncStatuses,
  type LocalManifest,
  type RemoteManifest,
} from '@shared/contracts/bundle';
import { asCatalogKey, type BundleSlug } from '@shared/contracts/ids';
import { seedActiveSync } from '../../../helpers/bundleSync';
import { makeBroadcaster, makeHealer, makeLauncherSettings } from '../../../helpers/fixtures';

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@main/services/clients', () => ({
  getClient: managerMocks.getClient,
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: managerMocks.getSettings,
}));

vi.mock('@main/services/bundle/api', () => ({
  fetchRemoteManifest: managerMocks.fetchRemoteManifest,
}));

const KEY = asCatalogKey('official:test-client');
const BUNDLE_SLUG = 'bundle-x' as BundleSlug;
const KEEP_FILE = 'mods/keep.jar';
const KEEP_CONTENT = 'keep-this-file';
const REAL_HASH = '0'.repeat(64);

let clientFolder: string;

const launcherSettings = () =>
  makeLauncherSettings({ clients: { [KEY]: { storage: { clientFolder } } } });

const sha256 = (input: string): string => createHash('sha256').update(input, 'utf8').digest('hex');

const seedDiskBundle = async (): Promise<string> => {
  const keepHash = sha256(KEEP_CONTENT);
  const keepPath = path.join(clientFolder, 'mods', 'keep.jar');
  await fs.mkdir(path.dirname(keepPath), { recursive: true });
  await fs.writeFile(keepPath, KEEP_CONTENT, 'utf8');

  const manifest: LocalManifest = {
    bundleSlug: BUNDLE_SLUG,
    manifestHash: REAL_HASH,
    syncedAt: new Date(0).toISOString(),
    files: { [KEEP_FILE]: { sha256: keepHash, size: KEEP_CONTENT.length } },
  };
  const sidecar = bundleManifestPath(clientFolder);
  await fs.mkdir(path.dirname(sidecar), { recursive: true });
  await fs.writeFile(sidecar, JSON.stringify(manifest, null, 2), 'utf8');
  return keepHash;
};

const remoteManifestFor = (keepHash: string): RemoteManifest => ({
  mods: [
    {
      path: KEEP_FILE,
      name: 'keep.jar',
      size: KEEP_CONTENT.length,
      isDir: false,
      sha256: keepHash,
      url: 'https://cdn.test.invalid/mods/keep.jar',
    },
  ],
});

const fileExists = async (target: string): Promise<boolean> => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

beforeEach(async () => {
  managerMocks.fetchRemoteManifest.mockReset();
  managerMocks.getClient.mockReset();
  managerMocks.getSettings.mockReset();
  clientFolder = await fs.mkdtemp(path.join(tmpdir(), 'bundle-resume-'));
  managerMocks.getClient.mockResolvedValue({ bundleSlug: BUNDLE_SLUG });
  managerMocks.getSettings.mockReturnValue(launcherSettings());
});

afterEach(async () => {
  await fs.rm(clientFolder, { recursive: true, force: true });
});

describe('BundleManager pause-during-fetch resume', () => {
  it('refetches on resume and never deletes the populated bundle', async () => {
    const keepHash = await seedDiskBundle();
    const realManifest = remoteManifestFor(keepHash);

    // First fetch parks until the pause aborts it; second fetch returns the
    // real manifest so resume plans against it instead of {}.
    managerMocks.fetchRemoteManifest
      .mockImplementationOnce(
        (_key: BundleSlug, signal?: AbortSignal) =>
          new Promise((_resolve, reject) => {
            const fail = () =>
              reject(new BundleError(BundleErrorCodes.ABORTED, 'Bundle manifest fetch aborted'));
            if (signal?.aborted) {
              fail();
              return;
            }
            signal?.addEventListener('abort', fail, { once: true });
          }),
      )
      .mockResolvedValueOnce({ manifest: realManifest, manifestHash: REAL_HASH });

    const broadcaster = makeBroadcaster();
    const manager = new BundleManager(broadcaster, makeHealer(), createClientOperationLocks());

    void manager.start({ key: KEY });

    await vi.waitFor(() => {
      expect(managerMocks.fetchRemoteManifest).toHaveBeenCalledTimes(1);
    });

    manager.pause(KEY);

    await vi.waitFor(() => {
      const statuses = vi.mocked(broadcaster.status).mock.calls.map(([e]) => e.status);
      expect(statuses).toContain(BundleSyncStatuses.PAUSED);
    });

    await manager.resume(KEY);

    await vi.waitFor(() => {
      const statuses = vi.mocked(broadcaster.status).mock.calls.map(([e]) => e.status);
      expect(statuses).toContain(BundleSyncStatuses.UP_TO_DATE);
    });

    expect(managerMocks.fetchRemoteManifest).toHaveBeenCalledTimes(2);
    expect(await fileExists(path.join(clientFolder, 'mods', 'keep.jar'))).toBe(true);

    const sidecarRaw = await fs.readFile(bundleManifestPath(clientFolder), 'utf8');
    const sidecar = JSON.parse(sidecarRaw) as LocalManifest;
    expect(sidecar.manifestHash).not.toBe('');
    expect(sidecar.manifestHash).toBe(REAL_HASH);
  });
});

describe('BundleManager persistLocalManifest guard', () => {
  it('skips the sidecar write when the remote manifest hash is empty', async () => {
    const store = new Map();
    const active = seedActiveSync(store, {
      key: KEY,
      clientFolder,
      bundleSlug: BUNDLE_SLUG,
      forLaunch: false,
    });
    expect(active.remoteManifestHash).toBe('');

    const manager = new BundleManager(
      makeBroadcaster(),
      makeHealer(),
      createClientOperationLocks(),
    );
    await (
      manager as unknown as {
        persistLocalManifest: (a: ActiveSync, folder: string) => Promise<void>;
      }
    ).persistLocalManifest(active, clientFolder);

    expect(await fileExists(bundleManifestPath(clientFolder))).toBe(false);
  });
});
