import {
  Loaders,
  type MinecraftKit,
  MinecraftKitError,
  MinecraftKitErrorCodes,
  type Target,
} from '@loontail/minecraft-kit';
import { describe, expect, it, vi } from 'vitest';

const workflowMocks = vi.hoisted(() => {
  return {
    resolveClientInstallPresence: vi.fn(),
    resolveLaunchVersion: vi.fn(),
  };
});

vi.mock('@loontail/minecraft-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@loontail/minecraft-kit')>();
  return { ...actual, resolveLaunchVersion: workflowMocks.resolveLaunchVersion };
});

vi.mock('@main/services/minecraft/installManifest', () => ({
  persistTargetInstallManifest: vi.fn(),
}));

vi.mock('@main/services/minecraft/readinessPolicy', () => ({
  resolveClientInstallPresence: workflowMocks.resolveClientInstallPresence,
}));

import { createBundleRepairIssueFilter } from '@main/services/bundle/ownership';
import type { Context } from '@main/services/minecraft/context';
import type { MinecraftEnv } from '@main/services/minecraft/env';
import { createForgeProcessorCache } from '@main/services/minecraft/forgeProcessorHealing';
import {
  ensureLaunchable,
  finalizeRepairCancellation,
  finalizeRepairFailure,
  verifyAndRepairBase,
} from '@main/services/minecraft/repairWorkflow';
import { asCatalogKey, type CatalogKey } from '@shared/contracts/ids';
import { InstallStatuses, MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { stubConsoleSink, stubOpenConsole } from './managerStubs';

const KEY = asCatalogKey('official:test-client');
const CLIENT_FOLDER = 'Z:/client';

const target = {
  id: 'target-id',
  directory: CLIENT_FOLDER,
  loader: { type: Loaders.VANILLA },
} as unknown as Target;

const context = (): Context =>
  ({
    item: { spec: { bundleSlug: null } },
    clientFolder: CLIENT_FOLDER,
    target,
  }) as unknown as Context;

const logger = () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  silly: vi.fn(),
  verbose: vi.fn(),
  warn: vi.fn(),
});

const env = (): MinecraftEnv => {
  const broadcaster = {
    status: vi.fn(),
    progress: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
  };
  return {
    kit: {} as MinecraftKit,
    broadcaster,
    ops: new Map<CatalogKey, never>(),
    forgeProcessorCache: createForgeProcessorCache(),
    console: stubConsoleSink(),
    openConsole: stubOpenConsole(),
    logger: logger(),
    emitStatus: broadcaster.status,
    emitError: vi.fn(),
    persistRuntime: vi.fn(),
    clearRuntimeOverride: vi.fn(),
    resolveBundleRepairFilter: vi.fn(async () => null),
    clearBundleManifest: vi.fn(async () => undefined),
  };
};

// Drive the single-source presence check (resolveClientInstallPresence) that
// emitPostOpStatus now uses instead of an inline manifest+files check.
const presence = (status: (typeof InstallStatuses)[keyof typeof InstallStatuses]): void => {
  workflowMocks.resolveClientInstallPresence.mockResolvedValue(status);
};

describe('repair workflow finalization', () => {
  it('finalizes cancellation as not-installed when the install is no longer present', async () => {
    presence(InstallStatuses.NOT_INSTALLED);
    const operationEnv = env();

    await finalizeRepairCancellation(operationEnv, KEY);

    expect(workflowMocks.resolveClientInstallPresence).toHaveBeenCalledWith(KEY);
    expect(operationEnv.emitError).not.toHaveBeenCalled();
    expect(operationEnv.broadcaster.status).toHaveBeenLastCalledWith({
      key: KEY,
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
  });

  it('finalizes cancellation as installed when files are still present', async () => {
    presence(InstallStatuses.INSTALLED);
    const operationEnv = env();

    await finalizeRepairCancellation(operationEnv, KEY);

    expect(operationEnv.broadcaster.status).toHaveBeenLastCalledWith({
      key: KEY,
      status: InstallStatuses.INSTALLED,
      paused: false,
    });
  });

  it('maps an unverified presence to the caller not-ready status on cancellation', async () => {
    presence(InstallStatuses.UNVERIFIED);
    const operationEnv = env();

    await finalizeRepairCancellation(operationEnv, KEY);

    expect(operationEnv.broadcaster.status).toHaveBeenLastCalledWith({
      key: KEY,
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
  });

  it('finalizes repair failure with mapped error and presence-based status', async () => {
    presence(InstallStatuses.NOT_INSTALLED);
    const operationEnv = env();
    const error = new MinecraftKitError(
      MinecraftKitErrorCodes.INTEGRITY_HASH_MISMATCH,
      'Library hash mismatch',
    );

    await finalizeRepairFailure({
      env: operationEnv,
      key: KEY,
      error,
      signal: new AbortController().signal,
    });

    expect(operationEnv.emitError).toHaveBeenCalledWith(
      KEY,
      MinecraftErrorCodes.INTEGRITY_ERROR,
      error.message,
    );
    expect(operationEnv.broadcaster.status).toHaveBeenLastCalledWith({
      key: KEY,
      status: InstallStatuses.ERROR,
      paused: false,
    });
  });
});

describe('ensureLaunchable', () => {
  it('runs a full install when the launch version JSON is missing', async () => {
    workflowMocks.resolveLaunchVersion.mockRejectedValue(new Error('no installed version json'));
    const plan = { totalActions: 3 };
    const installPlan = vi.fn(async () => plan);
    const runPlan = vi.fn(async () => undefined);
    const operationEnv: MinecraftEnv = {
      ...env(),
      kit: { install: { plan: installPlan } } as unknown as MinecraftKit,
    };

    await ensureLaunchable(operationEnv, KEY, context(), {
      signal: new AbortController().signal,
      runPlan,
    });

    expect(installPlan).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(runPlan).toHaveBeenCalledWith(plan);
  });

  it('skips the install when the launch version resolves (already launchable)', async () => {
    workflowMocks.resolveLaunchVersion.mockResolvedValue({
      versionId: '1.20.1',
      merged: {},
      chain: [],
    });
    const installPlan = vi.fn();
    const runPlan = vi.fn();
    const operationEnv: MinecraftEnv = {
      ...env(),
      kit: { install: { plan: installPlan } } as unknown as MinecraftKit,
    };

    await ensureLaunchable(operationEnv, KEY, context(), {
      signal: new AbortController().signal,
      runPlan,
    });

    expect(installPlan).not.toHaveBeenCalled();
    expect(runPlan).not.toHaveBeenCalled();
  });
});

describe('verifyAndRepairBase bundle ownership', () => {
  const bundleContext = (): Context =>
    ({
      item: { spec: { bundleSlug: 'pack-a' } },
      clientFolder: CLIENT_FOLDER,
      target,
    }) as unknown as Context;

  const repairOptions = () => ({
    signal: new AbortController().signal,
    onEvent: vi.fn(),
  });

  it('passes the injected filter to kit.repair.all and it skips bundle-owned issues', async () => {
    const ownedFilter = createBundleRepairIssueFilter(CLIENT_FOLDER, new Set(['mods/owned.jar']));
    const resolveBundleRepairFilter = vi.fn(async () => ownedFilter);
    const repairAll = vi.fn(async (_target: unknown, _options: unknown) => ({
      repairs: new Map(),
    }));
    const operationEnv: MinecraftEnv = {
      ...env(),
      kit: { repair: { all: repairAll } } as unknown as MinecraftKit,
      resolveBundleRepairFilter,
    };

    await verifyAndRepairBase(operationEnv, KEY, bundleContext(), repairOptions());

    expect(resolveBundleRepairFilter).toHaveBeenCalledWith(CLIENT_FOLDER, 'pack-a');
    expect(repairAll).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ shouldRepairIssue: ownedFilter }),
    );
    const passed = repairAll.mock.calls[0]?.[1] as { shouldRepairIssue: typeof ownedFilter };
    const skipsOwned = passed.shouldRepairIssue({
      issue: { path: `${CLIENT_FOLDER}/mods/owned.jar` },
    } as never);
    const repairsVanilla = passed.shouldRepairIssue({
      issue: { path: `${CLIENT_FOLDER}/libraries/x.jar` },
    } as never);
    expect(skipsOwned).toBe(false);
    expect(repairsVanilla).toBe(true);
  });

  it('repairs without a filter when the build has no bundle', async () => {
    const resolveBundleRepairFilter = vi.fn(async () => null);
    const repairAll = vi.fn(async (_target: unknown, _options: unknown) => ({
      repairs: new Map(),
    }));
    const operationEnv: MinecraftEnv = {
      ...env(),
      kit: { repair: { all: repairAll } } as unknown as MinecraftKit,
      resolveBundleRepairFilter,
    };

    await verifyAndRepairBase(operationEnv, KEY, context(), repairOptions());

    expect(resolveBundleRepairFilter).not.toHaveBeenCalled();
    expect(repairAll.mock.calls[0]?.[1]).not.toHaveProperty('shouldRepairIssue');
  });
});
