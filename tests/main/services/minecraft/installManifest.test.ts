import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  asMinecraftVersionId,
  type InstallPlan,
  Loaders,
  type MinecraftKit,
  type RepairAllReport,
  type Target,
  VerificationKinds,
} from '@loontail/minecraft-kit';
import { markCancelled } from '@main/infra/lifecyclePhase';
import type { Context } from '@main/services/minecraft/context';
import type { MinecraftEnv } from '@main/services/minecraft/env';
import { createForgeProcessorCache } from '@main/services/minecraft/forgeProcessorHealing';
import { runInstall } from '@main/services/minecraft/install';
import {
  createTargetInstallManifest,
  loadTargetInstallManifest,
  persistTargetInstallManifest,
  saveCurrentTargetInstallManifest,
  saveTargetInstallManifest,
  targetInstallManifestPath,
} from '@main/services/minecraft/installManifest';
import { type InstallOp, type Op, OpKinds, type RepairOp } from '@main/services/minecraft/ops';
import { runRepair } from '@main/services/minecraft/repair';
import { runUninstall } from '@main/services/minecraft/uninstall';
import { asCatalogKey, type CatalogKey } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { LoaderChoices } from '@shared/contracts/settings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubConsoleSink, stubOpenConsole } from './managerStubs';

const electronMocks = vi.hoisted(() => ({
  getPath: vi.fn(() => 'Z:/userData'),
}));

vi.mock('electron', () => ({
  app: {
    getPath: electronMocks.getPath,
  },
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const KEY = asCatalogKey('official:test-client');
const MINECRAFT_VERSION = asMinecraftVersionId('1.20.1');
const RUNTIME_COMPONENT = 'java-runtime-gamma';
const FABRIC_VERSION = '0.16.9';
const KIT_TARGET_ID = 'target-id';

const tempDirectories: string[] = [];

const target = (directory: string, patch: Partial<Target> = {}): Target =>
  ({
    id: KIT_TARGET_ID,
    directory,
    minecraft: {
      version: MINECRAFT_VERSION,
    },
    loader: {
      type: Loaders.FABRIC,
      minecraftVersion: MINECRAFT_VERSION,
      loaderVersion: FABRIC_VERSION,
    },
    runtime: {
      component: RUNTIME_COMPONENT,
      platformKey: 'windows-x64',
      versionName: '17.0.8',
      majorVersion: 17,
    },
    ...patch,
  }) as unknown as Target;

const context = (directory: string): Context =>
  ({
    item: { spec: { bundleSlug: null } },
    clientFolder: directory,
    loader: LoaderChoices.FABRIC,
    target: target(directory),
    resolved: {
      storage: {
        clientFolder: directory,
        clientsFolder: path.dirname(directory),
      },
    },
  }) as unknown as Context;

const installPlan = (directory: string): InstallPlan => ({
  targetId: KIT_TARGET_ID,
  directory,
  target: target(directory),
  actions: [],
  totalBytes: 0,
  totalActions: 0,
});

const repairAllReport = (): RepairAllReport => ({
  verifications: [],
  repairs: new Map([
    [
      VerificationKinds.MINECRAFT,
      {
        targetId: KIT_TARGET_ID,
        bytesDownloaded: 0,
        actionsCompleted: 0,
        durationMs: 0,
      },
    ],
  ]),
  blockedAspects: new Map(),
  bytesDownloaded: 0,
  durationMs: 0,
});

const installOp = (): InstallOp => ({
  kind: OpKinds.INSTALL,
  pauseController: {
    pause: vi.fn(),
    resume: vi.fn(),
  } as unknown as InstallOp['pauseController'],
  abort: new AbortController(),
  phase: 'running',
});

const logger = () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  silly: vi.fn(),
  verbose: vi.fn(),
  warn: vi.fn(),
});

const env = (kit: MinecraftKit, ops: Map<CatalogKey, Op>): MinecraftEnv => {
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

describe('target install manifest', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(tmpdir(), 'launcher-install-manifest-'));
    tempDirectories.push(directory);
  });

  afterEach(async () => {
    await Promise.all(
      tempDirectories
        .splice(0, tempDirectories.length)
        .map((entry) => fs.rm(entry, { recursive: true, force: true })),
    );
  });

  it('round-trips the current target identity through the sidecar manifest', async () => {
    const currentTarget = target(directory);
    await saveCurrentTargetInstallManifest(directory, currentTarget);

    expect(targetInstallManifestPath(directory)).toBe(
      path.join(directory, '.loontail', 'manifest.json'),
    );
    await expect(loadTargetInstallManifest(directory)).resolves.toMatchObject({
      version: 1,
      targetId: KIT_TARGET_ID,
      minecraftVersion: MINECRAFT_VERSION,
      loader: {
        type: Loaders.FABRIC,
        version: FABRIC_VERSION,
      },
      runtime: {
        component: RUNTIME_COMPONENT,
        platformKey: 'windows-x64',
        versionName: '17.0.8',
        majorVersion: 17,
      },
      kitVersion: expect.any(String),
      verifiedAt: expect.any(String),
    });
    await expect(fs.access(targetInstallManifestPath(directory))).resolves.toBeUndefined();
  });

  it('cleans up the tmp file when the atomic manifest write fails', async () => {
    const manifest = createTargetInstallManifest(target(directory), new Date(0));
    const finalPath = targetInstallManifestPath(directory);
    // Occupy the manifest path with a non-empty directory: the tmp write
    // succeeds, but the rm(target)+rename swap then fails — the helper must
    // remove the stray tmp before rethrowing so a retry starts clean.
    await fs.mkdir(finalPath, { recursive: true });
    await fs.writeFile(path.join(finalPath, 'occupied'), 'x');

    await expect(saveTargetInstallManifest(directory, manifest)).rejects.toThrow();
    await expect(fs.access(`${finalPath}.tmp`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('persistTargetInstallManifest writes the sidecar and swallows write failures', async () => {
    const currentTarget = target(directory);
    await persistTargetInstallManifest(KEY, directory, currentTarget, 'install');
    await expect(loadTargetInstallManifest(directory)).resolves.toMatchObject({
      targetId: KIT_TARGET_ID,
    });

    // A clientFolder occupied by a regular file makes the sidecar write fail;
    // the helper must warn and resolve rather than re-throw.
    const blocked = path.join(directory, 'blocked');
    await fs.writeFile(blocked, 'x');
    await expect(
      persistTargetInstallManifest(KEY, blocked, currentTarget, 'install'),
    ).resolves.toBeUndefined();
  });

  it('writes the manifest after successful install and repair operations', async () => {
    const currentContext = context(directory);
    const kit = {
      install: {
        plan: vi.fn(async () => installPlan(directory)),
        run: vi.fn(async () => undefined),
      },
      repair: {
        all: vi.fn(async () => repairAllReport()),
      },
    } as unknown as MinecraftKit;
    const installOperation = installOp();
    const installOps = new Map<CatalogKey, Op>([[KEY, installOperation]]);

    await runInstall(env(kit, installOps), KEY, currentContext, installOperation);

    await expect(loadTargetInstallManifest(directory)).resolves.toMatchObject({
      targetId: KIT_TARGET_ID,
    });

    await fs.unlink(targetInstallManifestPath(directory));

    const repairOperation: RepairOp = { kind: OpKinds.REPAIR, abort: new AbortController() };
    const repairOps = new Map<CatalogKey, Op>([[KEY, repairOperation]]);

    await runRepair(env(kit, repairOps), KEY, currentContext, repairOperation);

    await expect(loadTargetInstallManifest(directory)).resolves.toMatchObject({
      targetId: KIT_TARGET_ID,
    });
  });

  it('removes the cancelled install client folder', async () => {
    const currentContext = context(directory);
    await fs.writeFile(path.join(directory, 'partial.jar'), 'x');
    const installOperation = installOp();
    const kit = {
      install: {
        plan: vi.fn(async () => installPlan(directory)),
        run: vi.fn(async () => {
          installOperation.abort.abort();
          markCancelled(installOperation);
          throw new Error('Cancelled');
        }),
      },
    } as unknown as MinecraftKit;
    const installOps = new Map<CatalogKey, Op>([[KEY, installOperation]]);

    await expect(
      runInstall(env(kit, installOps), KEY, currentContext, installOperation),
    ).rejects.toThrow('Cancelled');

    await expect(fs.access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes the manifest when uninstall removes the client folder', async () => {
    const clientsRoot = await fs.mkdtemp(path.join(tmpdir(), 'launcher-clients-'));
    tempDirectories.push(clientsRoot);
    const clientFolder = path.join(clientsRoot, 'test-client');
    await fs.mkdir(clientFolder, { recursive: true });
    await saveCurrentTargetInstallManifest(clientFolder, target(clientFolder));
    const operationEnv = env({} as MinecraftKit, new Map<CatalogKey, Op>());

    await runUninstall(operationEnv, KEY, clientFolder, clientsRoot);

    await expect(loadTargetInstallManifest(clientFolder)).resolves.toBeNull();
    await expect(fs.access(clientFolder)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(operationEnv.clearRuntimeOverride).toHaveBeenCalledWith(KEY);
    expect(operationEnv.broadcaster.status).toHaveBeenLastCalledWith({
      key: KEY,
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
  });
});
