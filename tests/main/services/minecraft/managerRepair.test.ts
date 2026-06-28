import type { MinecraftKit, Target } from '@loontail/minecraft-kit';
import {
  ClientOperationDomains,
  type ClientOperationLocks,
  createClientOperationLocks,
} from '@main/services/clientOperationLocks';
import type { Broadcaster } from '@main/services/minecraft/broadcast';
import type { Context } from '@main/services/minecraft/context';
import { asCatalogKey } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { LoaderChoices } from '@shared/contracts/settings';
import { type MockInstance, beforeEach, describe, expect, it, vi } from 'vitest';

const orchestrationMocks = vi.hoisted(() => {
  return {
    buildContext: vi.fn(),
    getSettings: vi.fn(),
    runRepair: vi.fn(),
    setClientOverride: vi.fn(),
    resolveClientInstallPresence: vi.fn(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
});

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => orchestrationMocks.logger,
}));

vi.mock('@main/services/minecraft/context', () => ({
  buildContext: orchestrationMocks.buildContext,
}));

vi.mock('@main/services/minecraft/readinessPolicy', () => ({
  resolveClientInstallPresence: orchestrationMocks.resolveClientInstallPresence,
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: orchestrationMocks.getSettings,
  setClientOverride: orchestrationMocks.setClientOverride,
}));

vi.mock('@main/services/minecraft/repair', () => ({
  runRepair: orchestrationMocks.runRepair,
}));

import { MinecraftManager } from '@main/services/minecraft/manager';
import { OP_TO_STATUS, OpKinds } from '@main/services/minecraft/ops';
import { makeLauncherSettings, makeMinecraftBroadcaster } from '../../../helpers/fixtures';
import {
  stubAccountProvider,
  stubConsolePort,
  stubOpenConsole,
  stubResolveBuild,
  stubResolveBundleRepairFilter,
} from './managerStubs';

const SLUG = asCatalogKey('official:test-client');
const CLIENT_FOLDER = 'Z:/clients/test-client';
const CLIENTS_FOLDER = 'Z:/clients';

const launcherSettings = () => makeLauncherSettings({ storage: { clientsFolder: CLIENTS_FOLDER } });

const context = (): Context =>
  ({
    item: { spec: { bundleSlug: null }, presentation: { title: 'Test Client' } },
    clientFolder: CLIENT_FOLDER,
    loader: LoaderChoices.VANILLA,
    target: {} as Target,
    resolved: {
      memory: { allocatedRamMb: 0 },
      storage: { clientFolder: CLIENT_FOLDER, clientsFolder: CLIENTS_FOLDER },
      launch: { console: false, fullscreen: false },
    },
  }) as unknown as Context;

const makeManager = (
  broadcaster: Broadcaster,
  operationLocks: ClientOperationLocks,
): MinecraftManager =>
  new MinecraftManager(
    broadcaster,
    { targets: { resolve: vi.fn() } } as unknown as MinecraftKit,
    operationLocks,
    stubConsolePort(),
    stubOpenConsole(),
    stubAccountProvider(),
    stubResolveBundleRepairFilter(),
    stubResolveBuild(),
  );

const trackRepairReleases = (locks: ClientOperationLocks): MockInstance[] => {
  const releases: MockInstance[] = [];
  const acquire = locks.acquire.bind(locks);
  locks.acquire = (descriptor) => {
    const result = acquire(descriptor);
    if (result.kind === 'acquired' && descriptor.domain === ClientOperationDomains.MINECRAFT) {
      releases.push(vi.spyOn(result.lease, 'release'));
    }
    return result;
  };
  return releases;
};

beforeEach(() => {
  orchestrationMocks.buildContext.mockReset().mockResolvedValue(context());
  orchestrationMocks.getSettings.mockReset().mockReturnValue(launcherSettings());
  orchestrationMocks.runRepair.mockReset().mockResolvedValue(true);
  orchestrationMocks.resolveClientInstallPresence
    .mockReset()
    .mockResolvedValue(InstallStatuses.INSTALLED);
  orchestrationMocks.logger.warn.mockReset();
  orchestrationMocks.logger.error.mockReset();
});

describe('MinecraftManager.startRepair', () => {
  it('runs the bundle sync hook after a successful repair', async () => {
    orchestrationMocks.runRepair.mockResolvedValue(true);
    const manager = makeManager(makeMinecraftBroadcaster(), createClientOperationLocks());
    const hook = vi.fn().mockResolvedValue(undefined);
    manager.attachLaunchHook(hook);

    await manager.startRepair(SLUG);
    await vi.waitFor(() => {
      expect(hook).toHaveBeenCalledWith(SLUG, expect.any(AbortSignal));
    });
  });

  it('skips the bundle sync hook when the repair reports no work (repaired === false)', async () => {
    orchestrationMocks.runRepair.mockResolvedValue(false);
    const manager = makeManager(makeMinecraftBroadcaster(), createClientOperationLocks());
    const hook = vi.fn().mockResolvedValue(undefined);
    manager.attachLaunchHook(hook);

    await manager.startRepair(SLUG);
    await vi.waitFor(() => {
      expect(orchestrationMocks.runRepair).toHaveBeenCalled();
    });

    expect(hook).not.toHaveBeenCalled();
  });

  it('skips the bundle sync hook when the repair throws', async () => {
    orchestrationMocks.runRepair.mockRejectedValue(new Error('repair boom'));
    const manager = makeManager(makeMinecraftBroadcaster(), createClientOperationLocks());
    const hook = vi.fn().mockResolvedValue(undefined);
    manager.attachLaunchHook(hook);

    await manager.startRepair(SLUG);
    await vi.waitFor(() => {
      expect(orchestrationMocks.runRepair).toHaveBeenCalled();
    });

    expect(hook).not.toHaveBeenCalled();
  });

  it('swallows a hook rejection: logs a warn and startRepair still resolves', async () => {
    orchestrationMocks.runRepair.mockResolvedValue(true);
    const manager = makeManager(makeMinecraftBroadcaster(), createClientOperationLocks());
    const hook = vi.fn().mockRejectedValue(new Error('bundle boom'));
    manager.attachLaunchHook(hook);

    await expect(manager.startRepair(SLUG)).resolves.toBeUndefined();
    await vi.waitFor(() => {
      expect(orchestrationMocks.logger.warn).toHaveBeenCalled();
    });

    expect(orchestrationMocks.logger.error).not.toHaveBeenCalled();
  });

  it('releases the repair lock before invoking the bundle sync hook', async () => {
    orchestrationMocks.runRepair.mockResolvedValue(true);
    const operationLocks = createClientOperationLocks();
    const releases = trackRepairReleases(operationLocks);
    const manager = makeManager(makeMinecraftBroadcaster(), operationLocks);

    let releasedBeforeHook = false;
    const hook = vi.fn(async () => {
      const release = releases[0];
      releasedBeforeHook =
        releases.length === 1 && release !== undefined && release.mock.calls.length === 1;
    });
    manager.attachLaunchHook(hook);

    await manager.startRepair(SLUG);
    await vi.waitFor(() => {
      expect(hook).toHaveBeenCalledWith(SLUG, expect.any(AbortSignal));
    });

    expect(releasedBeforeHook).toBe(true);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toHaveBeenCalledTimes(1);
  });
});

describe('MinecraftManager.startRepair — post-repair BUNDLE_SYNCING op', () => {
  it('reports the BUNDLE_SYNCING status while the hook is pending, then falls back to presence once it resolves', async () => {
    orchestrationMocks.runRepair.mockResolvedValue(true);
    const manager = makeManager(makeMinecraftBroadcaster(), createClientOperationLocks());
    let resolveHook: () => void = () => undefined;
    const hook = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveHook = resolve;
        }),
    );
    manager.attachLaunchHook(hook);

    await manager.startRepair(SLUG);
    await vi.waitFor(() => {
      expect(hook).toHaveBeenCalledWith(SLUG, expect.any(AbortSignal));
    });

    expect(await manager.getStatus(SLUG)).toEqual({
      status: OP_TO_STATUS[OpKinds.BUNDLE_SYNCING],
      paused: false,
    });

    resolveHook();
    await vi.waitFor(async () => {
      expect(await manager.getStatus(SLUG)).toEqual({
        status: InstallStatuses.INSTALLED,
        paused: false,
      });
    });
  });

  it('aborts the hook signal on cancel(slug) and settles to presence without logging an error', async () => {
    orchestrationMocks.runRepair.mockResolvedValue(true);
    const manager = makeManager(makeMinecraftBroadcaster(), createClientOperationLocks());
    let capturedSignal: AbortSignal | undefined;
    const hook = vi.fn(
      (_slug, signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          capturedSignal = signal;
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    manager.attachLaunchHook(hook);

    await manager.startRepair(SLUG);
    await vi.waitFor(() => {
      expect(hook).toHaveBeenCalledWith(SLUG, expect.any(AbortSignal));
    });

    manager.cancel(SLUG);
    expect(capturedSignal?.aborted).toBe(true);

    await vi.waitFor(async () => {
      expect(await manager.getStatus(SLUG)).toEqual({
        status: InstallStatuses.INSTALLED,
        paused: false,
      });
    });
    expect(orchestrationMocks.logger.error).not.toHaveBeenCalled();
  });
});
