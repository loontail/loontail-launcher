import {
  type InstallPlan,
  type MinecraftKit,
  MinecraftKitError,
  MinecraftKitErrorCodes,
  type OperationOptions,
  PauseController,
  type RepairPlan,
  type Target,
} from '@loontail/minecraft-kit';
import type { Context } from '@main/services/minecraft/context';
import type { ManagerEnv } from '@main/services/minecraft/env';
import { runInstall } from '@main/services/minecraft/install';
import { type InstallOp, type Op, OpKinds } from '@main/services/minecraft/ops';
import { type ClientSlug, asClientSlug } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { LoaderChoices } from '@shared/contracts/settings';
import { describe, expect, it, vi } from 'vitest';

const SLUG = asClientSlug('test-client');
const CLIENT_FOLDER = 'Z:/missing-client-folder';

const emptyTarget = {} as Target;

const installPlan = (): InstallPlan => ({
  targetId: 'target-id',
  directory: CLIENT_FOLDER,
  target: emptyTarget,
  actions: [],
  totalBytes: 0,
  totalActions: 0,
});

const repairPlan = (): RepairPlan => ({
  targetId: 'target-id',
  directory: CLIENT_FOLDER,
  target: emptyTarget,
  actions: [],
  totalBytes: 0,
  totalActions: 0,
});

const makeLogger = () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  silly: vi.fn(),
  verbose: vi.fn(),
  warn: vi.fn(),
});

const makeContext = (): Context =>
  ({
    client: { slug: SLUG },
    clientFolder: CLIENT_FOLDER,
    loader: LoaderChoices.VANILLA,
    target: emptyTarget,
    resolved: {
      storage: {
        clientFolder: CLIENT_FOLDER,
        clientsFolder: 'Z:/clients',
      },
    },
  }) as unknown as Context;

const makeInstallOp = (): InstallOp => ({
  kind: OpKinds.INSTALL,
  status: InstallStatuses.INSTALLING,
  pauseController: new PauseController(),
  abort: new AbortController(),
  paused: false,
  cancelled: false,
  fresh: false,
});

const makeEnv = (kit: MinecraftKit, ops: Map<ClientSlug, Op>): ManagerEnv => {
  const broadcaster = {
    status: vi.fn(),
    progress: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
  };
  return {
    kit,
    broadcaster,
    ops,
    logger: makeLogger(),
    emitStatus: broadcaster.status,
    emitError: vi.fn(),
    emitErrorEvent: vi.fn(),
    persistRuntime: vi.fn(),
    clearRuntimeOverride: vi.fn(),
  };
};

describe('runInstall smart resume', () => {
  it('wires repair progress and releases the install slot when cancelled during resume', async () => {
    const originalError = new MinecraftKitError(
      MinecraftKitErrorCodes.INTEGRITY_HASH_MISMATCH,
      'Downloaded file hash mismatch',
    );
    let repairOptions: OperationOptions | undefined;
    const op = makeInstallOp();
    const kit = {
      install: {
        plan: vi.fn(async () => installPlan()),
        run: vi.fn().mockRejectedValueOnce(originalError),
      },
      repair: {
        fromError: vi.fn(async () => repairPlan()),
        minecraft: {
          run: vi.fn(async (_plan: RepairPlan, options?: OperationOptions) => {
            repairOptions = options;
            op.cancelled = true;
            op.abort.abort();
            throw new MinecraftKitError(MinecraftKitErrorCodes.NETWORK_ABORTED, 'Cancelled');
          }),
        },
      },
    } as unknown as MinecraftKit;
    const ops = new Map<ClientSlug, Op>([[SLUG, op]]);
    const env = makeEnv(kit, ops);

    await expect(runInstall(env, SLUG, makeContext(), op)).rejects.toBe(originalError);

    expect(repairOptions?.signal).toBe(op.abort.signal);
    expect(repairOptions?.onEvent).toEqual(expect.any(Function));
    expect(ops.has(SLUG)).toBe(false);
    expect(env.emitError).not.toHaveBeenCalled();
    expect(env.broadcaster.status).toHaveBeenCalledWith({
      slug: SLUG,
      status: InstallStatuses.REPAIRING,
      paused: false,
    });
    expect(env.broadcaster.status).toHaveBeenLastCalledWith({
      slug: SLUG,
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
  });
});
