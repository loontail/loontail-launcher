import type { ClientRequest } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
});

import { BUNDLE_PAUSED_SYNC_MAX_IDLE_MS } from '@main/constants/bundle';
import type { BundleBroadcaster } from '@main/services/bundle/broadcast';
import type { Healer } from '@main/services/bundle/healer';
import { BundleManager } from '@main/services/bundle/manager';
import type { SyncTask } from '@main/services/bundle/runner';
import { BundleErrorCodes, BundleSyncStatuses } from '@shared/contracts/bundle';
import type { ClientSlug } from '@shared/contracts/ids';

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

type Awaiter = { resolve: () => void; reject: (err: Error) => void };

type ActiveSyncShape = {
  task: SyncTask;
  lastProgress: null;
  remoteManifestHash: string;
  remoteManifest: Record<string, never>;
  bundleSlug: string;
  forLaunch: boolean;
  awaiters: Awaiter[];
  pauseIdleTimer: NodeJS.Timeout | null;
};

const SLUG = 'test-client' as ClientSlug;

const makeBroadcaster = (): BundleBroadcaster => ({
  status: vi.fn(),
  progress: vi.fn(),
  error: vi.fn(),
});

const makeHealer = (): Healer =>
  ({
    healAfterDeletes: vi.fn(async () => {}),
  }) as unknown as Healer;

const seedPausedActive = (
  manager: BundleManager,
  awaiter: Awaiter,
): { activeSyncs: Map<ClientSlug, ActiveSyncShape> } => {
  const task: SyncTask = {
    slug: SLUG,
    clientFolder: '/tmp/client',
    plan: {
      toDownload: [],
      toUpdate: [],
      toDelete: [],
      toSkip: [],
      bundleOwnedRelativePaths: new Set(),
      bytesTotal: 0,
    },
    abort: new AbortController(),
    currentRequests: new Set<ClientRequest>(),
    paused: true,
    cancelled: false,
    bytesDownloaded: 0,
    speedWindowStart: 0,
    speedWindowBytes: 0,
    processedFiles: 0,
    totalFiles: 0,
    lastEmittedAt: 0,
    pendingDownloads: [],
    pendingDeletes: [],
  };
  const active: ActiveSyncShape = {
    task,
    lastProgress: null,
    remoteManifestHash: '',
    remoteManifest: {},
    bundleSlug: 'bundle-x',
    forLaunch: true,
    awaiters: [awaiter],
    pauseIdleTimer: null,
  };
  const internals = manager as unknown as {
    activeSyncs: Map<ClientSlug, ActiveSyncShape>;
    armPauseIdleTimer: (slug: ClientSlug, active: ActiveSyncShape) => void;
  };
  internals.activeSyncs.set(SLUG, active);
  internals.armPauseIdleTimer.call(manager, SLUG, active);
  return { activeSyncs: internals.activeSyncs };
};

describe('BundleManager pause cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancel after pause rejects awaiters and frees the slot', async () => {
    const broadcaster = makeBroadcaster();
    const manager = new BundleManager(broadcaster, makeHealer());
    const rejected: Error[] = [];
    const awaiter: Awaiter = {
      resolve: () => {
        throw new Error('should not resolve');
      },
      reject: (err) => rejected.push(err),
    };

    const { activeSyncs } = seedPausedActive(manager, awaiter);
    expect(activeSyncs.has(SLUG)).toBe(true);

    manager.cancelSync(SLUG);

    expect(activeSyncs.has(SLUG)).toBe(false);
    expect(rejected).toHaveLength(1);
    const err = rejected[0] as Error & { code?: string };
    expect(err.code).toBe(BundleErrorCodes.ABORTED);
    expect(broadcaster.status).toHaveBeenCalledWith({
      slug: SLUG,
      status: BundleSyncStatuses.CANCELLED,
    });
  });

  it('idle timeout drops paused entry and rejects awaiters', async () => {
    const broadcaster = makeBroadcaster();
    const manager = new BundleManager(broadcaster, makeHealer());
    const rejected: Error[] = [];
    const awaiter: Awaiter = {
      resolve: () => {
        throw new Error('should not resolve');
      },
      reject: (err) => rejected.push(err),
    };

    const { activeSyncs } = seedPausedActive(manager, awaiter);
    expect(activeSyncs.has(SLUG)).toBe(true);

    vi.advanceTimersByTime(BUNDLE_PAUSED_SYNC_MAX_IDLE_MS + 1);

    expect(activeSyncs.has(SLUG)).toBe(false);
    expect(rejected).toHaveLength(1);
    const err = rejected[0] as Error & { code?: string };
    expect(err.code).toBe(BundleErrorCodes.ABORTED);
    expect(broadcaster.status).toHaveBeenCalledWith({
      slug: SLUG,
      status: BundleSyncStatuses.CANCELLED,
    });
  });
});
