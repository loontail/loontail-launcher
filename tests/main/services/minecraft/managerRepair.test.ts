import type { MinecraftKit, Target } from '@loontail/minecraft-kit';
import {
  ClientOperationDomains,
  type ClientOperationLocks,
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
    runRepair: vi.fn(),
    setClientOverride: vi.fn(),
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
  resolveClientInstallPresence: vi.fn(),
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: orchestrationMocks.getSettings,
  setClientOverride: orchestrationMocks.setClientOverride,
}));

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
  orchestrationMocks.logger.warn.mockReset();
  orchestrationMocks.logger.error.mockReset();
});

describe('MinecraftManager.startRepair', () => {
  it('runs the bundle sync hook after a successful repair', async () => {
    orchestrationMocks.runRepair.mockResolvedValue(true);
    const manager = makeManager(makeBroadcaster(), createClientOperationLocks());
    const hook = vi.fn().mockResolvedValue(undefined);
    manager.attachLaunchHook(hook);

    await manager.startRepair(SLUG);
    await vi.waitFor(() => {
      expect(hook).toHaveBeenCalledWith(SLUG);
    });
  });

  it('skips the bundle sync hook when the repair reports no work (repaired === false)', async () => {
    orchestrationMocks.runRepair.mockResolvedValue(false);
    const manager = makeManager(makeBroadcaster(), createClientOperationLocks());
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
    const manager = makeManager(makeBroadcaster(), createClientOperationLocks());
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
    const manager = makeManager(makeBroadcaster(), createClientOperationLocks());
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
    const manager = makeManager(makeBroadcaster(), operationLocks);

    let releasedBeforeHook = false;
    const hook = vi.fn(async () => {
      const release = releases[0];
      releasedBeforeHook =
        releases.length === 1 && release !== undefined && release.mock.calls.length === 1;
    });
    manager.attachLaunchHook(hook);

    await manager.startRepair(SLUG);
    await vi.waitFor(() => {
      expect(hook).toHaveBeenCalledWith(SLUG);
    });

    expect(releasedBeforeHook).toBe(true);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toHaveBeenCalledTimes(1);
  });
});
