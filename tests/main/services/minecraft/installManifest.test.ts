import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type InstallPlan,
  Loaders,
  type MinecraftKit,
  type RepairAllReport,
  type Target,
  VerificationKinds,
  asMinecraftVersionId,
} from '@loontail/minecraft-kit';
import type { Context } from '@main/services/minecraft/context';
import type { ManagerEnv } from '@main/services/minecraft/env';
import { runInstall } from '@main/services/minecraft/install';
import {
  createTargetInstallManifest,
  hasCurrentTargetInstallManifest,
  loadTargetInstallManifest,
  persistTargetInstallManifest,
  saveCurrentTargetInstallManifest,
  targetInstallManifestMatches,
  targetInstallManifestPath,
} from '@main/services/minecraft/installManifest';
import { type InstallOp, type Op, OpKinds, type RepairOp } from '@main/services/minecraft/ops';
import { runRepair } from '@main/services/minecraft/repair';
import { runUninstall } from '@main/services/minecraft/uninstall';
import { type ClientSlug, asClientSlug } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { LoaderChoices } from '@shared/contracts/settings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
});

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

const SLUG = asClientSlug('test-client');
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
    client: { slug: SLUG },
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
  bytesDownloaded: 0,
  durationMs: 0,
});

const installOp = (): InstallOp => ({
  kind: OpKinds.INSTALL,
  status: InstallStatuses.INSTALLING,
  pauseController: {
    pause: vi.fn(),
    resume: vi.fn(),
  } as unknown as InstallOp['pauseController'],
  abort: new AbortController(),
  paused: false,
  cancelled: false,
  fresh: false,
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

const env = (kit: MinecraftKit, ops: Map<ClientSlug, Op>): ManagerEnv => {
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
    logger: logger(),
    emitStatus: broadcaster.status,
    emitError: vi.fn(),
    emitErrorEvent: vi.fn(),
    persistRuntime: vi.fn(),
    clearRuntimeOverride: vi.fn(),
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
    await expect(hasCurrentTargetInstallManifest(directory, currentTarget)).resolves.toBe(true);
    await expect(fs.access(targetInstallManifestPath(directory))).resolves.toBeUndefined();
  });

  it('persistTargetInstallManifest writes the sidecar and swallows write failures', async () => {
    const currentTarget = target(directory);
    await persistTargetInstallManifest(SLUG, directory, currentTarget, 'install');
    await expect(hasCurrentTargetInstallManifest(directory, currentTarget)).resolves.toBe(true);

    // A clientFolder occupied by a regular file makes the sidecar write fail;
    // the helper must warn and resolve rather than re-throw.
    const blocked = path.join(directory, 'blocked');
    await fs.writeFile(blocked, 'x');
    await expect(
      persistTargetInstallManifest(SLUG, blocked, currentTarget, 'install'),
    ).resolves.toBeUndefined();
  });

  it('does not match stale target identity fields', () => {
    const currentTarget = target(directory);
    const manifest = createTargetInstallManifest(currentTarget, new Date(0));
    const changedRuntime = target(directory, {
      runtime: {
        ...currentTarget.runtime,
        component: 'java-runtime-delta',
      },
    });

    expect(targetInstallManifestMatches(manifest, currentTarget)).toBe(true);
    expect(targetInstallManifestMatches(manifest, changedRuntime)).toBe(false);
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
    const installOps = new Map<ClientSlug, Op>([[SLUG, installOperation]]);

    await runInstall(env(kit, installOps), SLUG, currentContext, installOperation);

    await expect(hasCurrentTargetInstallManifest(directory, currentContext.target)).resolves.toBe(
      true,
    );

    await fs.unlink(targetInstallManifestPath(directory));

    const repairOperation: RepairOp = { kind: OpKinds.REPAIR, abort: new AbortController() };
    const repairOps = new Map<ClientSlug, Op>([[SLUG, repairOperation]]);

    await runRepair(env(kit, repairOps), SLUG, currentContext, repairOperation);

    await expect(hasCurrentTargetInstallManifest(directory, currentContext.target)).resolves.toBe(
      true,
    );
  });

  it('removes the manifest when uninstall removes the client folder', async () => {
    const clientsRoot = await fs.mkdtemp(path.join(tmpdir(), 'launcher-clients-'));
    tempDirectories.push(clientsRoot);
    const clientFolder = path.join(clientsRoot, 'test-client');
    await fs.mkdir(clientFolder, { recursive: true });
    await saveCurrentTargetInstallManifest(clientFolder, target(clientFolder));
    const operationEnv = env({} as MinecraftKit, new Map<ClientSlug, Op>());

    await runUninstall(operationEnv, SLUG, clientFolder, clientsRoot);

    await expect(loadTargetInstallManifest(clientFolder)).resolves.toBeNull();
    await expect(fs.access(clientFolder)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(operationEnv.clearRuntimeOverride).toHaveBeenCalledWith(SLUG);
    expect(operationEnv.broadcaster.status).toHaveBeenLastCalledWith({
      slug: SLUG,
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
  });
});
