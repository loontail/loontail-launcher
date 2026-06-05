import {
  Loaders,
  type MinecraftKit,
  MinecraftKitError,
  MinecraftKitErrorCodes,
  type Target,
} from '@loontail/minecraft-kit';
import { describe, expect, it, vi } from 'vitest';

const workflowMocks = vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
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

import type { Context } from '@main/services/minecraft/context';
import type { ManagerEnv } from '@main/services/minecraft/env';
import { createForgeProcessorCache } from '@main/services/minecraft/forgeProcessorHealing';
import {
  ensureLaunchable,
  finalizeRepairCancellation,
  finalizeRepairFailure,
} from '@main/services/minecraft/repairWorkflow';
import { type ClientSlug, asClientSlug } from '@shared/contracts/ids';
import { InstallStatuses, MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { stubConsolePort, stubOpenConsole } from './managerStubs';

const SLUG = asClientSlug('test-client');
const CLIENT_FOLDER = 'Z:/client';

const target = {
  id: 'target-id',
  directory: CLIENT_FOLDER,
  loader: { type: Loaders.VANILLA },
} as unknown as Target;

const context = (): Context =>
  ({
    client: { slug: SLUG },
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

const env = (): ManagerEnv => {
  const broadcaster = {
    status: vi.fn(),
    progress: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
  };
  return {
    kit: {} as MinecraftKit,
    broadcaster,
    ops: new Map<ClientSlug, never>(),
    forgeProcessorCache: createForgeProcessorCache(),
    console: stubConsolePort(),
    openConsole: stubOpenConsole(),
    logger: logger(),
    emitStatus: broadcaster.status,
    emitError: vi.fn(),
    persistRuntime: vi.fn(),
    clearRuntimeOverride: vi.fn(),
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

    await finalizeRepairCancellation(operationEnv, SLUG);

    expect(workflowMocks.resolveClientInstallPresence).toHaveBeenCalledWith(SLUG);
    expect(operationEnv.emitError).not.toHaveBeenCalled();
    expect(operationEnv.broadcaster.status).toHaveBeenLastCalledWith({
      slug: SLUG,
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
  });

  it('finalizes cancellation as installed when files are still present', async () => {
    presence(InstallStatuses.INSTALLED);
    const operationEnv = env();

    await finalizeRepairCancellation(operationEnv, SLUG);

    expect(operationEnv.broadcaster.status).toHaveBeenLastCalledWith({
      slug: SLUG,
      status: InstallStatuses.INSTALLED,
      paused: false,
    });
  });

  it('maps an unverified presence to the caller not-ready status on cancellation', async () => {
    presence(InstallStatuses.UNVERIFIED);
    const operationEnv = env();

    await finalizeRepairCancellation(operationEnv, SLUG);

    expect(operationEnv.broadcaster.status).toHaveBeenLastCalledWith({
      slug: SLUG,
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
      slug: SLUG,
      error,
      signal: new AbortController().signal,
    });

    expect(operationEnv.emitError).toHaveBeenCalledWith(
      SLUG,
      MinecraftErrorCodes.INTEGRITY_ERROR,
      error.message,
    );
    expect(operationEnv.broadcaster.status).toHaveBeenLastCalledWith({
      slug: SLUG,
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
    const operationEnv: ManagerEnv = {
      ...env(),
      kit: { install: { plan: installPlan } } as unknown as MinecraftKit,
    };

    await ensureLaunchable(operationEnv, SLUG, context(), {
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
    const operationEnv: ManagerEnv = {
      ...env(),
      kit: { install: { plan: installPlan } } as unknown as MinecraftKit,
    };

    await ensureLaunchable(operationEnv, SLUG, context(), {
      signal: new AbortController().signal,
      runPlan,
    });

    expect(installPlan).not.toHaveBeenCalled();
    expect(runPlan).not.toHaveBeenCalled();
  });
});
