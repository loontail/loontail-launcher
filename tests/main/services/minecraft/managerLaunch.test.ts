import type { MinecraftKit, Target } from '@loontail/minecraft-kit';
import {
  ClientOperationDomains,
  type ClientOperationLocks,
  ClientOperationResources,
  createClientOperationLocks,
} from '@main/services/clientOperationLocks';
import type { Broadcaster } from '@main/services/minecraft/broadcast';
import type { Context } from '@main/services/minecraft/context';
import { ManagerError } from '@main/services/minecraft/errors';
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

vi.mock('@main/services/minecraft/installManifest', () => ({
  hasCurrentTargetInstallManifest: orchestrationMocks.hasCurrentTargetInstallManifest,
}));

vi.mock('@main/services/minecraft/readinessPolicy', () => ({
  resolveClientInstallPresence: vi.fn(),
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
import { stubConsolePort, stubOpenConsole } from './managerStubs';

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
  operationLocks: ClientOperationLocks = createClientOperationLocks(),
  accountProvider: () => Account | null = () => account(),
): MinecraftManager =>
  new MinecraftManager(
    broadcaster,
    {
      targets: { resolve: vi.fn() },
    } as unknown as MinecraftKit,
    operationLocks,
    stubConsolePort(),
    stubOpenConsole(),
    accountProvider,
  );

const resetMocks = (): void => {
  orchestrationMocks.buildContext.mockReset();
  orchestrationMocks.getSettings.mockReset();
  orchestrationMocks.hasCurrentTargetInstallManifest.mockReset();
  orchestrationMocks.isAnythingInstalled.mockReset();
  orchestrationMocks.runInstall.mockReset();
  orchestrationMocks.runLaunch.mockReset();
  orchestrationMocks.runRepair.mockReset();
  orchestrationMocks.setClientOverride.mockReset();

  orchestrationMocks.buildContext.mockResolvedValue(context());
  orchestrationMocks.getSettings.mockReturnValue(launcherSettings());
  orchestrationMocks.hasCurrentTargetInstallManifest.mockResolvedValue(true);
  orchestrationMocks.isAnythingInstalled.mockResolvedValue(false);
  orchestrationMocks.runInstall.mockResolvedValue(undefined);
  orchestrationMocks.runLaunch.mockResolvedValue(undefined);
  orchestrationMocks.runRepair.mockResolvedValue(true);
};

describe('MinecraftManager.startLaunch', () => {
  it('launches without running install or pre-launch hash verification', async () => {
    resetMocks();
    const ctx = context();
    orchestrationMocks.buildContext.mockResolvedValue(ctx);
    const currentAccount = account();

    await makeManager(undefined, undefined, () => currentAccount).startLaunch(SLUG);

    // The lenient preflight inside runLaunch is the only launch-time gate now —
    // startLaunch neither verifies hashes nor reinstalls implicitly.
    expect(orchestrationMocks.runInstall).not.toHaveBeenCalled();
    expect(orchestrationMocks.runLaunch).toHaveBeenCalledWith(
      expect.any(Object),
      SLUG,
      ctx,
      currentAccount,
    );
  });

  it('throws NO_ACCOUNT when the injected account provider returns null', async () => {
    resetMocks();

    await expect(
      makeManager(undefined, undefined, () => null).startLaunch(SLUG),
    ).rejects.toMatchObject({ code: MinecraftErrorCodes.NO_ACCOUNT });

    expect(orchestrationMocks.runLaunch).not.toHaveBeenCalled();
  });

  it('does not start the game when the launch hook fails', async () => {
    resetMocks();
    const manager = makeManager();
    const hookError = new Error('bundle sync failed');
    manager.attachLaunchHook(vi.fn().mockRejectedValue(hookError));

    await expect(manager.startLaunch(SLUG)).rejects.toBe(hookError);

    expect(orchestrationMocks.runLaunch).not.toHaveBeenCalled();
  });

  it('settles status to INSTALLED when a non-aborted bundle sync fails', async () => {
    resetMocks();
    const broadcaster = makeBroadcaster();
    const manager = makeManager(broadcaster);
    const hookError = new Error('bundle manifest fetch failed');
    manager.attachLaunchHook(vi.fn().mockRejectedValue(hookError));

    await expect(manager.startLaunch(SLUG)).rejects.toBe(hookError);

    // The base game is still installed: status must not stay stuck on LAUNCHING.
    expect(orchestrationMocks.runLaunch).not.toHaveBeenCalled();
    expect(broadcaster.status).toHaveBeenLastCalledWith({
      slug: SLUG,
      status: InstallStatuses.INSTALLED,
      paused: false,
    });
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

    const launchPromise = manager.startLaunch(SLUG);
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

  it('runs repair from any on-disk state once the context builds (no install gate)', async () => {
    resetMocks();
    const manager = makeManager(makeBroadcaster());
    // buildContext resolves the target; repair must run and let kit.repair.all
    // rebuild whatever is missing, even with no version JSON / empty folder.
    orchestrationMocks.buildContext.mockResolvedValue(context());

    await manager.startRepair(SLUG);

    expect(orchestrationMocks.runRepair).toHaveBeenCalled();
  });

  it('surfaces a missing install folder from buildContext instead of repairing', async () => {
    resetMocks();
    const manager = makeManager(makeBroadcaster());
    orchestrationMocks.buildContext.mockRejectedValue(
      new ManagerError(MinecraftErrorCodes.NO_CLIENT_FOLDER, 'no folder'),
    );

    await expect(manager.startRepair(SLUG)).rejects.toMatchObject({
      code: MinecraftErrorCodes.NO_CLIENT_FOLDER,
    });
    expect(orchestrationMocks.runRepair).not.toHaveBeenCalled();
  });
});
