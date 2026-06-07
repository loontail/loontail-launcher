import type { MinecraftKit, Target } from '@loontail/minecraft-kit';
import {
  ClientOperationDomains,
  type ClientOperationLocks,
  ClientOperationResources,
  createClientOperationLocks,
} from '@main/services/clientOperationLocks';
import type { Broadcaster } from '@main/services/minecraft/broadcast';
import type { Context } from '@main/services/minecraft/context';
import { asClientSlug } from '@shared/contracts/ids';
import { type LauncherSettings, LoaderChoices } from '@shared/contracts/settings';
import { type MockInstance, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { stubAccountProvider, stubConsolePort, stubOpenConsole } from './managerStubs';

const SLUG = asClientSlug('test-client');
const CLIENT_FOLDER = 'Z:/clients/test-client';
const CLIENTS_FOLDER = 'Z:/clients';

const launcherSettings = (): LauncherSettings => ({
  memory: { allocatedRamMb: 0 },
  storage: { clientsFolder: CLIENTS_FOLDER },
  launch: { console: false, fullscreen: false },
  clients: {},
});

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

const makeBroadcaster = (): Broadcaster =>
  ({
    status: vi.fn(),
    progress: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
  }) as unknown as Broadcaster;

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
});

describe('MinecraftManager.startInstall', () => {
  it('releases the install lock once and before the bundle sync claims the client folder', async () => {
    const operationLocks = createClientOperationLocks();
    const releases = trackInstallReleases(operationLocks);
    const manager = makeManager(makeBroadcaster(), operationLocks);

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
      expect(hook).toHaveBeenCalledWith(SLUG);
    });

    expect(hookAcquiredClientFolder).toBe(true);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toHaveBeenCalledTimes(1);
  });

  it('releases the install lock once when the install fails and skips the bundle sync', async () => {
    orchestrationMocks.runInstall.mockRejectedValue(new Error('install boom'));
    const operationLocks = createClientOperationLocks();
    const releases = trackInstallReleases(operationLocks);
    const manager = makeManager(makeBroadcaster(), operationLocks);
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
