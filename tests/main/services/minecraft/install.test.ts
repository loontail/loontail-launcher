import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
});

import {
  DownloadCategories,
  EventTypes,
  InstallActionKinds,
  InstallPhases,
  type InstallPlan,
  Loaders,
  type MinecraftKit,
  MinecraftKitError,
  MinecraftKitErrorCodes,
  type OperationOptions,
  type ProgressEvent,
  type RepairAllOptions,
  type RepairReport,
  type Target,
  type VerificationKind,
  VerificationKinds,
  type VerificationResult,
  VerifyFileCategories,
  VerifyFileStatuses,
} from '@loontail/minecraft-kit';
import { bundleManifestPath } from '@main/services/bundle/paths';
import type { Context } from '@main/services/minecraft/context';
import type { ManagerEnv } from '@main/services/minecraft/env';
import { type Op, OpKinds, type RepairOp } from '@main/services/minecraft/ops';
import { runRepair } from '@main/services/minecraft/repair';
import { type ClientSlug, asClientSlug } from '@shared/contracts/ids';
import { InstallStatuses, MinecraftErrorCodes, ProgressStages } from '@shared/contracts/minecraft';
import { LoaderChoices } from '@shared/contracts/settings';

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
  id: 'target-id',
  directory: CLIENT_FOLDER,
  minecraft: { version: '1.20.1' },
  loader: { type: Loaders.VANILLA },
  runtime: {
    component: RUNTIME_COMPONENT,
    manifestSha1: 'runtime-manifest-sha1',
    platformKey: 'windows-x64',
  },
} as unknown as Target;

const installPlan = (): InstallPlan => ({
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

  it('uses planned progress for Forge processor healing', async () => {
    const forgeLibrary = `${CLIENT_FOLDER}/libraries/net/minecraftforge/forge.jar`;
    const processorOutput = `${CLIENT_FOLDER}/versions/forge/processed.jar`;
    const forgeTarget = {
      ...emptyTarget,
      loader: { type: Loaders.FORGE },
    } as unknown as Target;
    const processorPlan: InstallPlan = {
      ...installPlan(),
      target: forgeTarget,
      actions: [
        {
          kind: InstallActionKinds.DOWNLOAD_FILE,
          url: 'https://files.test.invalid/forge.jar',
          target: forgeLibrary,
          expectedSize: 100,
          category: DownloadCategories.FORGE_LIBRARY,
        },
        {
          kind: InstallActionKinds.RUN_FORGE_PROCESSOR,
          index: 0,
          classpath: [forgeLibrary],
          args: [],
          outputs: { [processorOutput]: 'expected-sha1' },
        },
      ],
      totalActions: 2,
      totalBytes: 100,
    };
    const op: RepairOp = { kind: OpKinds.REPAIR, abort: new AbortController() };
    const kit = {
      repair: {
        all: vi.fn(async () => ({
          verifications: [],
          repairs: new Map(),
          bytesDownloaded: 0,
          durationMs: 1,
        })),
      },
      install: {
        plan: vi.fn(async () => processorPlan),
        run: vi.fn(async (_plan: InstallPlan, options?: OperationOptions) => {
          const file = {
            url: 'https://files.test.invalid/forge.jar',
            target: forgeLibrary,
            category: DownloadCategories.FORGE_LIBRARY,
          };
          options?.onEvent?.({
            type: EventTypes.INSTALL_PHASE_CHANGED,
            phase: InstallPhases.INSTALLING_FORGE,
            previous: null,
          });
          options?.onEvent?.({
            type: EventTypes.DOWNLOAD_STARTED,
            file,
            expectedSize: 100,
          });
          options?.onEvent?.({
            type: EventTypes.DOWNLOAD_PROGRESS,
            file,
            bytesDownloaded: 50,
            totalBytes: 100,
          });
        }),
      },
    } as unknown as MinecraftKit;
    const ops = new Map<ClientSlug, Op>([[SLUG, op]]);
    const env = makeEnv(kit, ops);
    const context = {
      ...makeContext(),
      target: forgeTarget,
    } as unknown as Context;

    await runRepair(env, SLUG, context, op);

    expect(kit.install.run).toHaveBeenCalledWith(
      expect.objectContaining({ totalActions: 2 }),
      expect.objectContaining({
        signal: op.abort.signal,
        onEvent: expect.any(Function),
      }),
    );
    expect(env.broadcaster.progress).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: SLUG,
        stage: ProgressStages.LOADER,
        totalBytes: 100,
      }),
    );
    expect(env.broadcaster.progress).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: SLUG,
        stage: ProgressStages.FINALIZE,
        overallPercent: 100,
      }),
    );
    expect(ops.has(SLUG)).toBe(false);
  });

  it('clears pending repair progress before the terminal status settles', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const pendingFile = `${CLIENT_FOLDER}/versions/1.20.1/1.20.1.jar`;
      const op: RepairOp = { kind: OpKinds.REPAIR, abort: new AbortController() };
      const kit = {
        repair: {
          all: vi.fn(async (_target: Target, options?: OperationOptions) => {
            const event = {
              type: EventTypes.VERIFY_FILE_CHECKED,
              file: {
                path: pendingFile,
                category: VerifyFileCategories.CLIENT_JAR,
                status: VerifyFileStatuses.MISSING,
              },
            } satisfies ProgressEvent;
            options?.onEvent?.(event);
            return {
              verifications: [],
              repairs: new Map(),
              bytesDownloaded: 0,
              durationMs: 1,
            };
          }),
        },
      } as unknown as MinecraftKit;
      const ops = new Map<ClientSlug, Op>([[SLUG, op]]);
      const env = makeEnv(kit, ops);

      await runRepair(env, SLUG, makeContext(), op);

      expect(env.broadcaster.status).toHaveBeenLastCalledWith({
        slug: SLUG,
        status: InstallStatuses.INSTALLED,
        paused: false,
      });
      expect(env.broadcaster.progress).not.toHaveBeenCalled();

      vi.advanceTimersByTime(101);

      expect(env.broadcaster.progress).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('filters bundle-owned paths during manual repair', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'launcher-repair-bundle-'));
    const bundleSlug = 'bundle-x';
    const bundleRelativePath = 'versions/1.20.1/1.20.1.jar';
    const vanillaRelativePath = 'libraries/com/example/lib.jar';
    const bundlePath = path.join(root, bundleRelativePath);
    const vanillaPath = path.join(root, vanillaRelativePath);
    const manifestPath = bundleManifestPath(root);
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        bundleSlug,
        manifestHash: 'bundle-manifest-hash',
        syncedAt: new Date(0).toISOString(),
        files: {
          [bundleRelativePath]: { sha256: 'bundle-sha256', size: 1 },
        },
      }),
      'utf8',
    );

    try {
      const target = {
        ...emptyTarget,
        id: 'target-id',
        directory: root,
        loader: { type: Loaders.VANILLA },
      } as unknown as Target;
      const context = {
        ...makeContext(),
        client: { slug: SLUG, bundleSlug },
        clientFolder: root,
        target,
      } as unknown as Context;
      const minecraftVerification: VerificationResult = {
        targetId: 'target-id',
        kind: VerificationKinds.MINECRAFT,
        isValid: false,
        checkedFiles: 2,
        durationMs: 1,
        issues: [
          {
            path: bundlePath,
            category: VerifyFileCategories.CLIENT_JAR,
            status: VerifyFileStatuses.CORRUPT,
          },
          {
            path: vanillaPath,
            category: VerifyFileCategories.LIBRARY,
            status: VerifyFileStatuses.MISSING,
          },
        ],
      };
      let shouldRepairIssue: RepairAllOptions['shouldRepairIssue'];
      const op: RepairOp = { kind: OpKinds.REPAIR, abort: new AbortController() };
      const kit = {
        repair: {
          all: vi.fn(async (_target: Target, options?: RepairAllOptions) => {
            shouldRepairIssue = options?.shouldRepairIssue;
            return {
              verifications: [minecraftVerification],
              repairs: new Map(),
              bytesDownloaded: 0,
              durationMs: 1,
            };
          }),
        },
      } as unknown as MinecraftKit;
      const ops = new Map<ClientSlug, Op>([[SLUG, op]]);
      const env = makeEnv(kit, ops);
      const [bundleIssue, vanillaIssue] = minecraftVerification.issues;
      if (bundleIssue === undefined || vanillaIssue === undefined) {
        throw new Error('Expected bundle and vanilla repair issues');
      }

      await runRepair(env, SLUG, context, op);

      expect(kit.repair.all).toHaveBeenCalledWith(
        target,
        expect.objectContaining({
          signal: op.abort.signal,
          onEvent: expect.any(Function),
          shouldRepairIssue: expect.any(Function),
        }),
      );
      expect(
        shouldRepairIssue?.({
          target,
          verification: minecraftVerification,
          issue: bundleIssue,
        }),
      ).toBe(false);
      expect(
        shouldRepairIssue?.({
          target,
          verification: minecraftVerification,
          issue: vanillaIssue,
        }),
      ).toBe(true);
      expect(env.broadcaster.status).toHaveBeenLastCalledWith({
        slug: SLUG,
        status: InstallStatuses.INSTALLED,
        paused: false,
      });
      const localManifestAfterRepair = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
        readonly files: Record<string, unknown>;
      };
      expect(localManifestAfterRepair.files).toHaveProperty(bundleRelativePath);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps a failed repair in error status when readiness is still broken', async () => {
    const repairError = new MinecraftKitError(
      MinecraftKitErrorCodes.INTEGRITY_HASH_MISMATCH,
      'Library hash mismatch',
    );
    const op: RepairOp = { kind: OpKinds.REPAIR, abort: new AbortController() };
    const kit = {
      repair: {
        all: vi.fn().mockRejectedValue(repairError),
      },
      verify: {
        targetReady: {
          run: vi.fn(async () => ({ isReady: false })),
        },
      },
    } as unknown as MinecraftKit;
    const ops = new Map<ClientSlug, Op>([[SLUG, op]]);
    const env = makeEnv(kit, ops);

    await runRepair(env, SLUG, makeContext(), op);

    expect(env.emitError).toHaveBeenCalledWith(
      SLUG,
      MinecraftErrorCodes.INTEGRITY_ERROR,
      repairError.message,
    );
    expect(env.broadcaster.status).toHaveBeenLastCalledWith({
      slug: SLUG,
      status: InstallStatuses.ERROR,
      paused: false,
    });
    expect(ops.has(SLUG)).toBe(false);
  });

  it('does not emit an error event when repair cancellation leaves the target not ready', async () => {
    const cancelError = new MinecraftKitError(MinecraftKitErrorCodes.NETWORK_ABORTED, 'Cancelled');
    const op: RepairOp = { kind: OpKinds.REPAIR, abort: new AbortController() };
    let repairSignal: AbortSignal | undefined;
    const targetReady = vi.fn(async () => ({ isReady: false }));
    const kit = {
      repair: {
        all: vi.fn(async (_target: Target, options?: OperationOptions) => {
          repairSignal = options?.signal;
          op.abort.abort();
          throw cancelError;
        }),
      },
      verify: {
        targetReady: {
          run: targetReady,
        },
      },
    } as unknown as MinecraftKit;
    const ops = new Map<ClientSlug, Op>([[SLUG, op]]);
    const env = makeEnv(kit, ops);

    await runRepair(env, SLUG, makeContext(), op);

    expect(kit.repair.all).toHaveBeenCalledWith(
      emptyTarget,
      expect.objectContaining({ signal: op.abort.signal, onEvent: expect.any(Function) }),
    );
    expect(repairSignal).toBe(op.abort.signal);
    expect(env.emitError).not.toHaveBeenCalled();
    expect(env.emitErrorEvent).not.toHaveBeenCalled();
    expect(targetReady).not.toHaveBeenCalled();
    expect(env.broadcaster.status).toHaveBeenLastCalledWith({
      slug: SLUG,
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
    expect(ops.has(SLUG)).toBe(false);
  });
});
