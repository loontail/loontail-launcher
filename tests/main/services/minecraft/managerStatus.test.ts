import { type MinecraftKit, PauseController } from '@loontail/minecraft-kit';
import { describe, expect, it, vi } from 'vitest';

const statusMocks = vi.hoisted(() => {
  return {
    buildContext: vi.fn(),
    getSettings: vi.fn(),
    hasAnyVersionInstalled: vi.fn(),
    resolveClientInstallPresence: vi.fn(),
    setClientOverride: vi.fn(),
  };
});

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@main/services/minecraft/context', () => ({
  buildContext: statusMocks.buildContext,
}));

vi.mock('@main/services/minecraft/installedVersions', () => ({
  hasAnyVersionInstalled: statusMocks.hasAnyVersionInstalled,
}));

vi.mock('@main/services/minecraft/readinessPolicy', () => ({
  resolveClientInstallPresence: statusMocks.resolveClientInstallPresence,
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: statusMocks.getSettings,
  setClientOverride: statusMocks.setClientOverride,
}));

import { createClientOperationLocks } from '@main/services/clientOperationLocks';
import { MinecraftManager } from '@main/services/minecraft/manager';
import { type InstallOp, OpKinds, type OpMap } from '@main/services/minecraft/ops';
import { asCatalogKey } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { makeLauncherSettings, makeMinecraftBroadcaster } from '../../../helpers/fixtures';
import {
  stubAccountProvider,
  stubClearBundleManifest,
  stubConsoleSink,
  stubOpenConsole,
  stubResolveBuild,
  stubResolveBundleRepairFilter,
} from './managerStubs';

const KEY = asCatalogKey('official:test-client');

const launcherSettings = () => makeLauncherSettings();

const makeManager = (ops?: OpMap): MinecraftManager =>
  new MinecraftManager(
    makeMinecraftBroadcaster(),
    {
      targets: { resolve: vi.fn() },
    } as unknown as MinecraftKit,
    createClientOperationLocks(),
    stubConsoleSink(),
    stubOpenConsole(),
    stubAccountProvider(),
    stubResolveBundleRepairFilter(),
    stubClearBundleManifest(),
    stubResolveBuild(),
    ops ?? new Map(),
  );

const resetStatusMocks = (): void => {
  statusMocks.buildContext.mockReset();
  statusMocks.getSettings.mockReset();
  statusMocks.hasAnyVersionInstalled.mockReset();
  statusMocks.resolveClientInstallPresence.mockReset();
  statusMocks.setClientOverride.mockReset();

  statusMocks.getSettings.mockReturnValue(launcherSettings());
  statusMocks.hasAnyVersionInstalled.mockResolvedValue(false);
  statusMocks.resolveClientInstallPresence.mockResolvedValue(InstallStatuses.INSTALLED);
};

describe('MinecraftManager.getStatus', () => {
  it('seeds installed status straight from the cheap presence check', async () => {
    resetStatusMocks();
    statusMocks.resolveClientInstallPresence.mockResolvedValue(InstallStatuses.INSTALLED);

    await expect(makeManager().getStatus(KEY)).resolves.toEqual({
      status: InstallStatuses.INSTALLED,
      paused: false,
    });
    expect(statusMocks.resolveClientInstallPresence).toHaveBeenCalledWith(KEY);
  });

  it('seeds not-installed without any readiness verification', async () => {
    resetStatusMocks();
    statusMocks.resolveClientInstallPresence.mockResolvedValue(InstallStatuses.NOT_INSTALLED);

    await expect(makeManager().getStatus(KEY)).resolves.toEqual({
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
  });

  it('seeds unverified when the client context cannot be resolved but old files exist', async () => {
    resetStatusMocks();
    statusMocks.resolveClientInstallPresence.mockResolvedValue(InstallStatuses.UNVERIFIED);

    await expect(makeManager().getStatus(KEY)).resolves.toEqual({
      status: InstallStatuses.UNVERIFIED,
      paused: false,
    });
  });

  it('reports an in-flight install op as installing with its paused flag', async () => {
    resetStatusMocks();
    const ops: OpMap = new Map();
    const manager = makeManager(ops);
    const op: InstallOp = {
      kind: OpKinds.INSTALL,
      pauseController: new PauseController(),
      abort: new AbortController(),
      phase: 'paused',
    };
    ops.set(KEY, op);

    await expect(manager.getStatus(KEY)).resolves.toEqual({
      status: InstallStatuses.INSTALLING,
      paused: true,
    });
    // An in-flight op short-circuits before the cheap presence seed.
    expect(statusMocks.resolveClientInstallPresence).not.toHaveBeenCalled();
  });
});
