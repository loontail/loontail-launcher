import type { MinecraftKit, Target } from '@loontail/minecraft-kit';
import {
  ClientOperationDomains,
  type ClientOperationLocks,
  ClientOperationResources,
  createClientOperationLocks,
} from '@main/services/clientOperationLocks';
import type { Broadcaster } from '@main/services/minecraft/broadcast';
import type { Context } from '@main/services/minecraft/context';
import { OpKinds } from '@main/services/minecraft/ops';
import type { Account } from '@shared/contracts/account';
import { type ClientSlug, asClientSlug } from '@shared/contracts/ids';
import { InstallStatuses, MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { type LauncherSettings, LoaderChoices } from '@shared/contracts/settings';
import { describe, expect, it, vi } from 'vitest';

const orchestrationMocks = vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
  return {
    buildContext: vi.fn(),
    getSettings: vi.fn(),
    hasCurrentTargetInstallManifest: vi.fn(),
    isAnythingInstalled: vi.fn(),
    isTargetReady: vi.fn(),
    readinessKinds: {
      INSTALLED: 'installed',
      NEEDS_INSTALL: 'needs-install',
      NEEDS_REPAIR: 'needs-repair',
      UNVERIFIED: 'unverified',
    },
    resolveTargetReadinessPolicy: vi.fn(),
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
  isTargetReady: orchestrationMocks.isTargetReady,
}));

vi.mock('@main/services/minecraft/installManifest', () => ({
  hasCurrentTargetInstallManifest: orchestrationMocks.hasCurrentTargetInstallManifest,
}));

vi.mock('@main/services/minecraft/readinessPolicy', () => ({
  ReadinessPolicyKinds: orchestrationMocks.readinessKinds,
  resolveClientReadinessPolicy: vi.fn(),
  resolveTargetReadinessPolicy: orchestrationMocks.resolveTargetReadinessPolicy,
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

const SLUG = asClientSlug('test-client');
const CLIENT_FOLDER = 'Z:/clients/test-client';
const CLIENTS_FOLDER = 'Z:/clients';

const launcherSettings = (): LauncherSettings => ({
  memory: { allocatedRamMb: 0 },
  storage: { clientsFolder: CLIENTS_FOLDER },
  launch: { console: false, fullscreen: false },
  clients: {},
});

const account = (): Account => ({
  provider: 'yggdrasil',
  username: 'tester',
  email: null,
  skin: null,
  cape: null,
});

const context = (): Context =>
  ({
    client: { slug: SLUG, title: 'Test Client' },
    clientFolder: CLIENT_FOLDER,
    loader: LoaderChoices.VANILLA,
    target: {} as Target,
    resolved: {
      memory: { allocatedRamMb: 0 },
      storage: { clientFolder: CLIENT_FOLDER, clientsFolder: CLIENTS_FOLDER },
      launch: { console: false, fullscreen: false },
    },
  }) as unknown as Context;

const makeBroadcaster = (): Broadcaster =>
  ({
    status: vi.fn(),
    progress: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
  }) as unknown as Broadcaster;

const makeManager = (
  broadcaster = makeBroadcaster(),
  operationLocks?: ClientOperationLocks,
): MinecraftManager =>
  new MinecraftManager(
    broadcaster,
    {
      targets: { resolve: vi.fn() },
    } as unknown as MinecraftKit,
    operationLocks,
  );

const resetMocks = (): void => {
  orchestrationMocks.buildContext.mockReset();
  orchestrationMocks.getSettings.mockReset();
  orchestrationMocks.hasCurrentTargetInstallManifest.mockReset();
  orchestrationMocks.isAnythingInstalled.mockReset();
  orchestrationMocks.isTargetReady.mockReset();
  orchestrationMocks.resolveTargetReadinessPolicy.mockReset();
  orchestrationMocks.runInstall.mockReset();
  orchestrationMocks.runLaunch.mockReset();
  orchestrationMocks.runRepair.mockReset();
  orchestrationMocks.setClientOverride.mockReset();

  orchestrationMocks.buildContext.mockResolvedValue(context());
  orchestrationMocks.getSettings.mockReturnValue(launcherSettings());
  orchestrationMocks.hasCurrentTargetInstallManifest.mockResolvedValue(true);
  orchestrationMocks.isAnythingInstalled.mockResolvedValue(false);
  orchestrationMocks.isTargetReady.mockResolvedValue(true);
  orchestrationMocks.resolveTargetReadinessPolicy.mockResolvedValue({
    kind: orchestrationMocks.readinessKinds.INSTALLED,
    status: InstallStatuses.INSTALLED,
    freshInstall: false,
  });
  orchestrationMocks.runInstall.mockResolvedValue(undefined);
  orchestrationMocks.runLaunch.mockResolvedValue(undefined);
  orchestrationMocks.runRepair.mockResolvedValue(true);
};

describe('MinecraftManager.startLaunch', () => {
  it('launches a ready target without running install first', async () => {
    resetMocks();
    const ctx = context();
    orchestrationMocks.buildContext.mockResolvedValue(ctx);
    const currentAccount = account();

    await makeManager().startLaunch(SLUG, currentAccount);

    expect(orchestrationMocks.runInstall).not.toHaveBeenCalled();
    expect(orchestrationMocks.runLaunch).toHaveBeenCalledWith(
      expect.any(Object),
      SLUG,
      ctx,
      currentAccount,
    );
  });

  it('installs a missing target before launching it', async () => {
    resetMocks();
    const broadcaster = makeBroadcaster();
    const ctx = context();
    orchestrationMocks.buildContext.mockResolvedValue(ctx);
    orchestrationMocks.resolveTargetReadinessPolicy.mockResolvedValue({
      kind: orchestrationMocks.readinessKinds.NEEDS_REPAIR,
      status: InstallStatuses.NOT_INSTALLED,
      freshInstall: true,
    });

    await makeManager(broadcaster).startLaunch(SLUG, account());

    expect(orchestrationMocks.runInstall).toHaveBeenCalledWith(
      expect.any(Object),
      SLUG,
      ctx,
      expect.objectContaining({ fresh: true }),
    );
    expect(orchestrationMocks.runLaunch).toHaveBeenCalledTimes(1);
    expect(orchestrationMocks.runInstall.mock.invocationCallOrder[0]).toBeLessThan(
      orchestrationMocks.runLaunch.mock.invocationCallOrder[0] ?? 0,
    );
    expect(broadcaster.status).toHaveBeenCalledWith({
      slug: SLUG,
      status: InstallStatuses.INSTALLING,
      paused: false,
      loader: LoaderChoices.VANILLA,
    });
  });

  it('installs a ready target when its durable manifest is stale', async () => {
    resetMocks();
    const ctx = context();
    orchestrationMocks.buildContext.mockResolvedValue(ctx);
    orchestrationMocks.resolveTargetReadinessPolicy.mockResolvedValue({
      kind: orchestrationMocks.readinessKinds.NEEDS_INSTALL,
      status: InstallStatuses.NOT_INSTALLED,
      freshInstall: false,
    });

    await makeManager().startLaunch(SLUG, account());

    expect(orchestrationMocks.runInstall).toHaveBeenCalledWith(
      expect.any(Object),
      SLUG,
      ctx,
      expect.objectContaining({ fresh: false }),
    );
    expect(orchestrationMocks.runLaunch).toHaveBeenCalledTimes(1);
  });

  it('does not start the game when the launch hook fails', async () => {
    resetMocks();
    const manager = makeManager();
    const hookError = new Error('bundle sync failed');
    manager.attachLaunchHook(vi.fn().mockRejectedValue(hookError));

    await expect(manager.startLaunch(SLUG, account())).rejects.toBe(hookError);

    expect(orchestrationMocks.runLaunch).not.toHaveBeenCalled();
  });

  it('aborts an in-flight launch hook and restores installed status', async () => {
    resetMocks();
    const broadcaster = makeBroadcaster();
    const manager = makeManager(broadcaster);
    let hookSignal: AbortSignal | undefined;
    let resolveHookStarted: () => void = () => undefined;
    const hookStarted = new Promise<void>((resolve) => {
      resolveHookStarted = resolve;
    });
    manager.attachLaunchHook(
      vi.fn(
        (_slug: ClientSlug, signal?: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            hookSignal = signal;
            resolveHookStarted();
            signal?.addEventListener('abort', () => reject(new Error('bundle sync aborted')), {
              once: true,
            });
          }),
      ),
    );

    const launchPromise = manager.startLaunch(SLUG, account());
    await hookStarted;
    manager.cancel(SLUG);

    await expect(launchPromise).resolves.toBeUndefined();
    expect(hookSignal?.aborted).toBe(true);
    expect(orchestrationMocks.runLaunch).not.toHaveBeenCalled();
    expect(broadcaster.status).toHaveBeenLastCalledWith({
      slug: SLUG,
      status: InstallStatuses.INSTALLED,
      paused: false,
    });
  });

  it('rejects repair while a bundle writer lock is held for the same client', async () => {
    resetMocks();
    const operationLocks = createClientOperationLocks();
    const bundleLock = operationLocks.acquire({
      slug: SLUG,
      domain: ClientOperationDomains.BUNDLE,
      resources: [ClientOperationResources.CLIENT_FOLDER],
    });
    if (bundleLock.kind !== 'acquired') throw new Error('Expected bundle lock');

    try {
      await expect(
        makeManager(makeBroadcaster(), operationLocks).startRepair(SLUG),
      ).rejects.toMatchObject({
        code: MinecraftErrorCodes.OP_IN_FLIGHT,
      });
      expect(orchestrationMocks.buildContext).not.toHaveBeenCalled();
    } finally {
      bundleLock.lease.release();
    }
  });

  it('refreshes bundle state after a successful manual repair', async () => {
    resetMocks();
    const operationLocks = createClientOperationLocks();
    const broadcaster = makeBroadcaster();
    const manager = makeManager(broadcaster, operationLocks);
    const ctx = context();
    orchestrationMocks.buildContext.mockResolvedValue(ctx);
    orchestrationMocks.isAnythingInstalled.mockResolvedValue(true);

    let bundleLockAcquired = false;
    const hook = vi.fn(async () => {
      const bundleLock = operationLocks.acquire({
        slug: SLUG,
        domain: ClientOperationDomains.BUNDLE,
        resources: [ClientOperationResources.CLIENT_FOLDER],
      });
      if (bundleLock.kind !== 'acquired') return;
      bundleLockAcquired = true;
      bundleLock.lease.release();
    });
    manager.attachLaunchHook(hook);

    await manager.startRepair(SLUG);

    await vi.waitFor(() => {
      expect(hook).toHaveBeenCalledWith(SLUG);
    });
    expect(bundleLockAcquired).toBe(true);
    expect(orchestrationMocks.runRepair).toHaveBeenCalledWith(
      expect.any(Object),
      SLUG,
      ctx,
      expect.objectContaining({ kind: OpKinds.REPAIR }),
    );
    expect(broadcaster.status).toHaveBeenCalledWith({
      slug: SLUG,
      status: InstallStatuses.REPAIRING,
      paused: false,
    });
  });
});
