import {
  Loaders,
  type MinecraftKit,
  MinecraftKitError,
  MinecraftKitErrorCodes,
  type Target,
} from '@loontail/minecraft-kit';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
});

import type { Context } from '@main/services/minecraft/context';
import type { ManagerEnv } from '@main/services/minecraft/env';
import {
  finalizeRepairCancellation,
  finalizeRepairFailure,
} from '@main/services/minecraft/repairWorkflow';
import { type ClientSlug, asClientSlug } from '@shared/contracts/ids';
import { InstallStatuses, MinecraftErrorCodes } from '@shared/contracts/minecraft';

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

const env = (kit: MinecraftKit): ManagerEnv => {
  const broadcaster = {
    status: vi.fn(),
    progress: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
  };
  return {
    kit,
    broadcaster,
    ops: new Map<ClientSlug, never>(),
    logger: logger(),
    emitStatus: broadcaster.status,
    emitError: vi.fn(),
    emitErrorEvent: vi.fn(),
    persistRuntime: vi.fn(),
    clearRuntimeOverride: vi.fn(),
  };
};

const kitWithReadiness = (isReady: boolean): MinecraftKit =>
  ({
    verify: {
      targetReady: {
        run: vi.fn(async () => ({ isReady })),
      },
    },
  }) as unknown as MinecraftKit;

describe('repair workflow finalization', () => {
  it('finalizes cancellation from readiness without emitting errors', async () => {
    const operationEnv = env(kitWithReadiness(false));

    await finalizeRepairCancellation(operationEnv, SLUG, context());

    expect(operationEnv.emitError).not.toHaveBeenCalled();
    expect(operationEnv.emitErrorEvent).not.toHaveBeenCalled();
    expect(operationEnv.broadcaster.status).toHaveBeenLastCalledWith({
      slug: SLUG,
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
  });

  it('finalizes repair failure with mapped error and readiness status', async () => {
    const operationEnv = env(kitWithReadiness(false));
    const error = new MinecraftKitError(
      MinecraftKitErrorCodes.INTEGRITY_HASH_MISMATCH,
      'Library hash mismatch',
    );

    await finalizeRepairFailure({
      env: operationEnv,
      slug: SLUG,
      ctx: context(),
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
