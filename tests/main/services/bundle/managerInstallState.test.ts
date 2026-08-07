import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const managerMocks = vi.hoisted(() => {
  return {
    buildPlan: vi.fn(),
    fetchRemoteManifest: vi.fn(),
    getClient: vi.fn(),
    getSettings: vi.fn(),
    loadLocalManifest: vi.fn(),
    runSyncPhases: vi.fn(),
    saveLocalManifest: vi.fn(),
  };
});

import { MANIFEST_DRIFT_TTL_MS } from '@main/constants/bundle';
import { BundleManager, type GetClient } from '@main/services/bundle/manager';
import { createClientOperationLocks } from '@main/services/clientOperationLocks';
import { asCatalogKey } from '@shared/contracts/ids';
import { makeBroadcaster, makeHealer, makeLauncherSettings } from '../../../helpers/fixtures';

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@main/services/settings/settings', () => ({ getSettings: managerMocks.getSettings }));
vi.mock('@main/services/bundle/api', () => ({
  fetchRemoteManifest: managerMocks.fetchRemoteManifest,
}));
vi.mock('@main/services/bundle/manifestRepo', () => ({
  clearLocalManifest: vi.fn(),
  loadLocalManifest: managerMocks.loadLocalManifest,
  saveLocalManifest: managerMocks.saveLocalManifest,
}));
vi.mock('@main/services/bundle/plan', () => ({ buildPlan: managerMocks.buildPlan }));
vi.mock('@main/services/bundle/runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/bundle/runner')>();
  return { ...actual, runSyncPhases: managerMocks.runSyncPhases };
});

const KEY = asCatalogKey('official:test-client');
const BUNDLE_SLUG = 'bundle-x';
const CLIENT_FOLDER = '/tmp/client';
const REMOTE_HASH = 'a'.repeat(64);

const fakeGetClient = managerMocks.getClient as unknown as GetClient;

const EMPTY_PLAN = {
  toDownload: [],
  toUpdate: [],
  toDelete: [],
  toSkip: [],
  bundleOwnedRelativePaths: new Set<string>(),
  bytesTotal: 0,
};

const launcherSettings = () =>
  makeLauncherSettings({
    storage: { clientsFolder: '' },
    clients: { [KEY]: { storage: { clientFolder: CLIENT_FOLDER } } },
  });

const localManifest = (manifestHash: string) => ({
  bundleSlug: BUNDLE_SLUG,
  manifestHash,
  syncedAt: '2026-06-13T00:00:00.000Z',
  files: {},
});

const makeManager = (activeSyncs = new Map()) =>
  new BundleManager(
    makeBroadcaster(),
    makeHealer(),
    createClientOperationLocks(),
    activeSyncs,
    fakeGetClient,
  );

beforeEach(() => {
  vi.useFakeTimers();
  managerMocks.buildPlan.mockReset().mockResolvedValue(EMPTY_PLAN);
  managerMocks.fetchRemoteManifest
    .mockReset()
    .mockResolvedValue({ manifest: {}, manifestHash: REMOTE_HASH });
  managerMocks.getClient.mockReset().mockResolvedValue({ bundleSlug: BUNDLE_SLUG });
  managerMocks.getSettings.mockReset().mockReturnValue(launcherSettings());
  managerMocks.loadLocalManifest.mockReset().mockResolvedValue(localManifest(REMOTE_HASH));
  managerMocks.runSyncPhases.mockReset().mockResolvedValue({ deletedAny: false });
  managerMocks.saveLocalManifest.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BundleManager.getStatus manifest-hash TTL cache', () => {
  it('reuses the cached remote hash for a second call inside the TTL (one fetch)', async () => {
    const manager = makeManager();

    const first = await manager.getStatus(KEY);
    const second = await manager.getStatus(KEY);

    expect(managerMocks.fetchRemoteManifest).toHaveBeenCalledTimes(1);
    expect(first.signatureMatches).toBe(true);
    expect(second.signatureMatches).toBe(true);
  });

  it('refetches once the TTL has elapsed', async () => {
    const manager = makeManager();

    await manager.getStatus(KEY);
    vi.advanceTimersByTime(MANIFEST_DRIFT_TTL_MS + 1);
    await manager.getStatus(KEY);

    expect(managerMocks.fetchRemoteManifest).toHaveBeenCalledTimes(2);
  });

  it('reads the local manifest fresh every call and never caches signatureMatches', async () => {
    const manager = makeManager();

    // Same cached remote hash, but the local manifest drifts between calls: the
    // second call must observe the mismatch (the boolean is never cached).
    managerMocks.loadLocalManifest
      .mockResolvedValueOnce(localManifest(REMOTE_HASH))
      .mockResolvedValueOnce(localManifest('b'.repeat(64)));

    const matched = await manager.getStatus(KEY);
    const drifted = await manager.getStatus(KEY);

    expect(managerMocks.fetchRemoteManifest).toHaveBeenCalledTimes(1);
    expect(managerMocks.loadLocalManifest).toHaveBeenCalledTimes(2);
    expect(matched.signatureMatches).toBe(true);
    expect(drifted.signatureMatches).toBe(false);
  });

  it('degrades to signatureMatches:true when the drift-check fetch fails (timeout)', async () => {
    const manager = makeManager();
    // A dead network is bounded by AbortSignal.timeout: the manager passes a
    // signal to fetchRemoteManifest and the rejection (as a fired timeout would
    // produce) collapses to the non-gating fallback. Assert the timeout signal
    // is wired, then drive the rejection.
    let passedSignal: AbortSignal | undefined;
    managerMocks.fetchRemoteManifest.mockImplementation((_key, signal?: AbortSignal) => {
      passedSignal = signal;
      return Promise.reject(new Error('aborted by timeout'));
    });
    managerMocks.loadLocalManifest.mockResolvedValue(localManifest('b'.repeat(64)));

    const state = await manager.getStatus(KEY);

    expect(passedSignal).toBeInstanceOf(AbortSignal);
    expect(state).toEqual({ installed: true, signatureMatches: true, progress: null });
  });

  it('reuses the hash a completed sync primed — zero fetches within the TTL', async () => {
    const manager = makeManager();

    await manager.start({ key: KEY });
    expect(managerMocks.fetchRemoteManifest).toHaveBeenCalledTimes(1);

    const state = await manager.getStatus(KEY);

    // The sync's fetch seeded the cache, so the status probe adds no round-trip.
    expect(managerMocks.fetchRemoteManifest).toHaveBeenCalledTimes(1);
    expect(state.signatureMatches).toBe(true);
  });

  it('the sync path always fetches fresh even with a warm cache', async () => {
    const manager = makeManager();

    // Prime the cache via a status probe, then run a sync: the sync must NOT
    // reuse the cached hash — it always fetches the manifest fresh.
    await manager.getStatus(KEY);
    expect(managerMocks.fetchRemoteManifest).toHaveBeenCalledTimes(1);

    await manager.start({ key: KEY });

    expect(managerMocks.fetchRemoteManifest).toHaveBeenCalledTimes(2);
  });
});
