import type { MinecraftKit, Target } from '@loontail/minecraft-kit';
import {
  ClientOperationDomains,
  type ClientOperationLocks,
  ClientOperationResources,
  createClientOperationLocks,
} from '@main/services/clientOperationLocks';
import type { Broadcaster } from '@main/services/minecraft/broadcast';
import type { Context } from '@main/services/minecraft/context';
import { asCatalogKey } from '@shared/contracts/ids';
import { InstallStatuses, MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { LoaderChoices } from '@shared/contracts/settings';
import { type MockInstance, beforeEach, describe, expect, it, vi } from 'vitest';

const orchestrationMocks = vi.hoisted(() => {
  return {
    buildContext: vi.fn(),
    getSettings: vi.fn(),
    isAnythingInstalled: vi.fn(),
    resolveClientInstallPresence: vi.fn(),
    runInstall: vi.fn(),
    runLaunch: vi.fn(),
    runRepair: vi.fn(),
    setClientOverride: vi.fn(),
  };
});

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@main/services/minecraft/context', () => ({
  buildContext: orchestrationMocks.buildContext,
}));

vi.mock('@main/services/minecraft/runtimeState', () => ({
  isAnythingInstalled: orchestrationMocks.isAnythingInstalled,
}));

vi.mock('@main/services/minecraft/readinessPolicy', () => ({
  resolveClientInstallPresence: orchestrationMocks.resolveClientInstallPresence,
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: orchestrationMocks.getSettings,
  setClientOverride: orchestrationMocks.setClientOverride,
}));

vi.mock('@main/services/minecraft/install', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/minecraft/install')>();
  return { ...actual, runInstall: orchestrationMocks.runInstall };
});

vi.mock('@main/services/minecraft/launch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/minecraft/launch')>();
  return { ...actual, runLaunch: orchestrationMocks.runLaunch };
});

vi.mock('@main/services/minecraft/repair', () => ({
  runRepair: orchestrationMocks.runRepair,
}));

import { MinecraftManager } from '@main/services/minecraft/manager';
import { OP_TO_STATUS, OpKinds, type OpRegistry } from '@main/services/minecraft/ops';
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
  ops?: OpRegistry,
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
    ops,
  );

// Wraps the shared lock registry so each MINECRAFT-domain lease's release() is
// observable. The bundle sync hook acquires a BUNDLE lease, which is ignored.
const trackInstallReleases = (locks: ClientOperationLocks): MockInstance[] => {
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
  orchestrationMocks.runInstall.mockReset().mockResolvedValue(undefined);
  orchestrationMocks.resolveClientInstallPresence
    .mockReset()
    .mockResolvedValue(InstallStatuses.NOT_INSTALLED);
});

describe('MinecraftManager.startInstall', () => {
  it('releases the install lock once and before the bundle sync claims the client folder', async () => {
    const operationLocks = createClientOperationLocks();
    const releases = trackInstallReleases(operationLocks);
    const manager = makeManager(makeMinecraftBroadcaster(), operationLocks);

    let hookAcquiredClientFolder = false;
    const hook = vi.fn(async () => {
      const bundleLock = operationLocks.acquire({
        slug: SLUG,
        domain: ClientOperationDomains.BUNDLE,
        resources: [ClientOperationResources.CLIENT_FOLDER],
      });
      if (bundleLock.kind === 'acquired') {
        hookAcquiredClientFolder = true;
        bundleLock.lease.release();
      }
    });
    manager.attachLaunchHook(hook);

    await manager.startInstall(SLUG);
    await vi.waitFor(() => {
      expect(hook).toHaveBeenCalledWith(SLUG, expect.any(AbortSignal));
    });

    expect(hookAcquiredClientFolder).toBe(true);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toHaveBeenCalledTimes(1);
  });

  it('releases the install lock once when the install fails and skips the bundle sync', async () => {
    orchestrationMocks.runInstall.mockRejectedValue(new Error('install boom'));
    const operationLocks = createClientOperationLocks();
    const releases = trackInstallReleases(operationLocks);
    const manager = makeManager(makeMinecraftBroadcaster(), operationLocks);
    const hook = vi.fn();
    manager.attachLaunchHook(hook);

    await manager.startInstall(SLUG);
    await vi.waitFor(() => {
      expect(releases[0]).toHaveBeenCalledTimes(1);
    });

    expect(releases).toHaveLength(1);
    expect(hook).not.toHaveBeenCalled();
  });
});

describe('MinecraftManager.startInstall — post-install BUNDLE_SYNCING op', () => {
  it('reports the BUNDLE_SYNCING status while the hook is pending, then falls back to presence once it resolves', async () => {
    orchestrationMocks.resolveClientInstallPresence.mockResolvedValue(InstallStatuses.INSTALLED);
    const manager = makeManager(makeMinecraftBroadcaster(), createClientOperationLocks());
    let resolveHook: () => void = () => undefined;
    const hook = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveHook = resolve;
        }),
    );
    manager.attachLaunchHook(hook);

    await manager.startInstall(SLUG);
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
    orchestrationMocks.resolveClientInstallPresence.mockResolvedValue(InstallStatuses.INSTALLED);
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

    await manager.startInstall(SLUG);
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
  });
});

describe('MinecraftManager.startInstall — INSTALLED → launchHook ordering + non-fatal hook failure', () => {
  it('emits INSTALLED before the first hook call', async () => {
    orchestrationMocks.resolveClientInstallPresence.mockResolvedValue(InstallStatuses.INSTALLED);
    const broadcaster = makeMinecraftBroadcaster();
    const manager = makeManager(broadcaster, createClientOperationLocks());
    const hook = vi.fn().mockResolvedValue(undefined);
    manager.attachLaunchHook(hook);

    await manager.startInstall(SLUG);
    await vi.waitFor(() => {
      expect(hook).toHaveBeenCalledWith(SLUG, expect.any(AbortSignal));
    });

    // beginInstall/startInstall emit INSTALLING first, so isolate the INSTALLED
    // status call and assert it was invoked before the hook fired.
    const statusSpy = broadcaster.status as unknown as MockInstance;
    const installedCall = statusSpy.mock.calls.findIndex(
      ([payload]) => payload.status === InstallStatuses.INSTALLED,
    );
    expect(installedCall).toBeGreaterThanOrEqual(0);
    const installedOrder = statusSpy.mock.invocationCallOrder[installedCall];
    const hookOrder = (hook as unknown as MockInstance).mock.invocationCallOrder[0];
    if (installedOrder === undefined || hookOrder === undefined) {
      throw new Error('expected both the INSTALLED status and the hook to have been invoked');
    }
    expect(installedOrder).toBeLessThan(hookOrder);
  });

  it('keeps the final status INSTALLED and never reports broadcaster.error when the hook rejects', async () => {
    orchestrationMocks.resolveClientInstallPresence.mockResolvedValue(InstallStatuses.INSTALLED);
    const broadcaster = makeMinecraftBroadcaster();
    const manager = makeManager(broadcaster, createClientOperationLocks());
    const hook = vi.fn().mockRejectedValue(new Error('bundle boom'));
    manager.attachLaunchHook(hook);

    await manager.startInstall(SLUG);
    await vi.waitFor(() => {
      expect(hook).toHaveBeenCalledWith(SLUG, expect.any(AbortSignal));
    });

    await vi.waitFor(async () => {
      expect(await manager.getStatus(SLUG)).toEqual({
        status: InstallStatuses.INSTALLED,
        paused: false,
      });
    });
    expect(broadcaster.error).not.toHaveBeenCalled();
  });

  it('never invokes the hook when a cancel lands during the buildContext window', async () => {
    orchestrationMocks.resolveClientInstallPresence.mockResolvedValue(
      InstallStatuses.NOT_INSTALLED,
    );
    const manager = makeManager(makeMinecraftBroadcaster(), createClientOperationLocks());
    const hook = vi.fn().mockResolvedValue(undefined);
    manager.attachLaunchHook(hook);
    let resolveContext: (ctx: Context) => void = () => undefined;
    orchestrationMocks.buildContext.mockReturnValue(
      new Promise<Context>((resolve) => {
        resolveContext = resolve;
      }),
    );

    const install = manager.startInstall(SLUG);
    manager.cancel(SLUG);
    resolveContext(context());
    await install;

    expect(orchestrationMocks.runInstall).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
  });
});

describe('MinecraftManager.startInstall — INSTALL_STARTING placeholder op', () => {
  it('registers the op before buildContext resolves so status reads INSTALLING and a concurrent launch trips OP_IN_FLIGHT', async () => {
    const operationLocks = createClientOperationLocks();
    const manager = makeManager(makeMinecraftBroadcaster(), operationLocks);
    let resolveContext: (ctx: Context) => void = () => undefined;
    orchestrationMocks.buildContext.mockReturnValue(
      new Promise<Context>((resolve) => {
        resolveContext = resolve;
      }),
    );

    const install = manager.startInstall(SLUG);

    // While the first buildContext is still pending, status already reads
    // INSTALLING and a second concurrent launch must reject synchronously.
    expect(await manager.getStatus(SLUG)).toEqual({
      status: InstallStatuses.INSTALLING,
      paused: false,
    });
    await expect(manager.startLaunch(SLUG)).rejects.toMatchObject({
      code: MinecraftErrorCodes.OP_IN_FLIGHT,
    });
    expect(orchestrationMocks.runInstall).not.toHaveBeenCalled();

    resolveContext(context());
    await install;
    await vi.waitFor(() => {
      expect(orchestrationMocks.runInstall).toHaveBeenCalledTimes(1);
    });
    // beginInstall carried the placeholder controller forward into the real op.
    expect(orchestrationMocks.runInstall).toHaveBeenCalledWith(
      expect.any(Object),
      SLUG,
      expect.any(Object),
      expect.objectContaining({ kind: OpKinds.INSTALL }),
    );
  });

  it('honors a cancel during the buildContext window: no runInstall, op removed, lock released, status falls back to presence', async () => {
    orchestrationMocks.resolveClientInstallPresence.mockResolvedValue(
      InstallStatuses.NOT_INSTALLED,
    );
    const operationLocks = createClientOperationLocks();
    const releases = trackInstallReleases(operationLocks);
    const broadcaster = makeMinecraftBroadcaster();
    const manager = makeManager(broadcaster, operationLocks);
    let resolveContext: (ctx: Context) => void = () => undefined;
    orchestrationMocks.buildContext.mockReturnValue(
      new Promise<Context>((resolve) => {
        resolveContext = resolve;
      }),
    );

    const install = manager.startInstall(SLUG);
    // Stop aborts the INSTALL_STARTING placeholder controller; buildContext then
    // resolves and the after-await guard short-circuits before beginInstall.
    manager.cancel(SLUG);
    resolveContext(context());
    await install;

    expect(orchestrationMocks.runInstall).not.toHaveBeenCalled();
    expect(await manager.getStatus(SLUG)).toEqual({
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
    expect(releases).toHaveLength(1);
    expect(releases[0]).toHaveBeenCalledTimes(1);
    expect(broadcaster.status).toHaveBeenLastCalledWith({
      slug: SLUG,
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
  });
});
