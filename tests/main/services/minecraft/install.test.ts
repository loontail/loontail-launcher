import path from 'node:path';
import {
  EventTypes,
  type InstallPlan,
  Loaders,
  type MinecraftKit,
  MinecraftKitError,
  MinecraftKitErrorCodes,
  type OperationOptions,
  PauseController,
  type ProgressEvent,
  type RepairPlan,
  type RepairReport,
  type Target,
  type VerificationKind,
  VerificationKinds,
} from '@loontail/minecraft-kit';
import type { Context } from '@main/services/minecraft/context';
import type { ManagerEnv } from '@main/services/minecraft/env';
import { runInstall } from '@main/services/minecraft/install';
import { type InstallOp, type Op, OpKinds, type RepairOp } from '@main/services/minecraft/ops';
import { runRepair } from '@main/services/minecraft/repair';
import { type ClientSlug, asClientSlug } from '@shared/contracts/ids';
import { InstallStatuses, ProgressStages } from '@shared/contracts/minecraft';
import { LoaderChoices } from '@shared/contracts/settings';
import { describe, expect, it, vi } from 'vitest';

const SLUG = asClientSlug('test-client');
const CLIENT_FOLDER = 'Z:/missing-client-folder';
const USER_DATA = 'Z:/userData';
const RUNTIME_COMPONENT = 'java-runtime-gamma';

const electronMocks = vi.hoisted(() => ({
  getPath: vi.fn(() => 'Z:/userData'),
}));

vi.mock('electron', () => ({
  app: {
    getPath: electronMocks.getPath,
  },
}));

const emptyTarget = {
  loader: { type: Loaders.VANILLA },
  runtime: { component: RUNTIME_COMPONENT },
} as unknown as Target;

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

const repairReport = (): RepairReport => ({
  targetId: 'target-id',
  bytesDownloaded: 0,
  actionsCompleted: 1,
  durationMs: 1,
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

describe('runRepair', () => {
  it('maps runtime repair progress and refreshes the persisted runtime ref', async () => {
    const runtimeFile = `${CLIENT_FOLDER}/runtime/${RUNTIME_COMPONENT}/bin/javaw.exe`;
    const op: RepairOp = { kind: OpKinds.REPAIR, abort: new AbortController() };
    const kit = {
      repair: {
        all: vi.fn(async (_target: Target, options?: OperationOptions) => {
          const event = {
            type: EventTypes.VERIFY_FILE_CHECKED,
            aspect: VerificationKinds.RUNTIME,
            file: {
              path: runtimeFile,
              category: 'runtime-file',
              status: 'missing',
            },
          } satisfies ProgressEvent & { readonly aspect: VerificationKind };
          options?.onEvent?.(event);
          return {
            verifications: [],
            repairs: new Map([[VerificationKinds.RUNTIME, repairReport()]]),
            bytesDownloaded: 0,
            durationMs: 1,
          };
        }),
      },
    } as unknown as MinecraftKit;
    const ops = new Map<ClientSlug, Op>([[SLUG, op]]);
    const env = makeEnv(kit, ops);

    await runRepair(env, SLUG, makeContext(), op);

    expect(env.broadcaster.progress).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: SLUG,
        stage: ProgressStages.RUNTIME,
        currentFile: runtimeFile,
      }),
    );
    expect(env.persistRuntime).toHaveBeenCalledWith(SLUG, {
      component: RUNTIME_COMPONENT,
      path: path.join(USER_DATA, 'runtimes', RUNTIME_COMPONENT),
    });
    expect(env.broadcaster.status).toHaveBeenLastCalledWith({
      slug: SLUG,
      status: InstallStatuses.INSTALLED,
      paused: false,
    });
    expect(ops.has(SLUG)).toBe(false);
  });
});
