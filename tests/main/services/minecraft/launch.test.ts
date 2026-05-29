import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  Architectures,
  AuthModes,
  type LaunchComposition,
  type LaunchRunOptions,
  type LaunchSession,
  Loaders,
  type MinecraftKit,
  OperatingSystems,
  type Target,
  asMinecraftVersionId,
  targetPaths,
} from '@loontail/minecraft-kit';
import type { Context } from '@main/services/minecraft/context';
import type { ManagerEnv } from '@main/services/minecraft/env';
import { runLaunch } from '@main/services/minecraft/launch';
import { type Op, OpKinds } from '@main/services/minecraft/ops';
import type { Account } from '@shared/contracts/account';
import type { AuthSession, YggdrasilSession } from '@shared/contracts/auth';
import { type ClientSlug, asClientSlug } from '@shared/contracts/ids';
import { InstallStatuses, MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { LoaderChoices } from '@shared/contracts/settings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const launchMocks = vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
  return {
    appGetVersion: vi.fn(() => '0.0.0-test'),
    getStoredAuth: vi.fn<() => AuthSession | null>(() => null),
    openConsoleWindow: vi.fn(),
    consoleHub: {
      emitState: vi.fn(),
      hasWindow: vi.fn(() => false),
      recordMinecraft: vi.fn(),
      recordSystem: vi.fn(),
      setActiveSession: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  app: {
    getVersion: launchMocks.appGetVersion,
    isPackaged: false,
  },
}));

vi.mock('@main/config', () => ({
  mainConfig: { yggdrasilApiRoot: 'https://auth.test.invalid' },
}));

vi.mock('@main/infra/consoleHub', () => ({
  consoleHub: launchMocks.consoleHub,
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    silly: vi.fn(),
    verbose: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('@main/infra/store', () => ({
  getStoredAuth: launchMocks.getStoredAuth,
}));

vi.mock('@main/windows/consoleWindow', () => ({
  openConsoleWindow: launchMocks.openConsoleWindow,
}));

const SLUG = asClientSlug('test-client');
const CLIENT_FOLDER = 'Z:/clients/test-client';
const VERSION_ID = asMinecraftVersionId('1.20.1');
const TEST_MAIN_CLASS = 'net.minecraft.client.main.Main';
const tempDirs: string[] = [];

const account = (): Account => ({
  provider: 'yggdrasil',
  username: 'tester',
  email: null,
  skin: null,
  cape: null,
});

const yggdrasilSession = (): YggdrasilSession => ({
  provider: 'yggdrasil',
  accessToken: 'access-token',
  clientToken: 'client-token',
  profile: { uuid: '0123456789abcdef0123456789abcdef', name: 'tester' },
});

const target = (directory: string): Target =>
  ({
    id: 'target-id',
    directory,
    minecraft: {
      version: VERSION_ID,
      manifest: {
        id: VERSION_ID,
        type: 'release',
        mainClass: TEST_MAIN_CLASS,
        assetIndex: {
          id: 'assets',
          sha1: 'asset-index-sha1',
          size: 1,
          totalSize: 1,
          url: 'https://assets.test.invalid/index.json',
        },
        assets: 'assets',
        downloads: {
          client: {
            sha1: 'client-sha1',
            size: 1,
            url: 'https://assets.test.invalid/client.jar',
          },
        },
        libraries: [],
      },
      channel: 'release',
      summary: {
        id: VERSION_ID,
        type: 'release',
        url: 'https://assets.test.invalid/version.json',
        time: '2026-05-29T00:00:00Z',
        releaseTime: '2026-05-29T00:00:00Z',
      },
    },
    loader: { type: Loaders.VANILLA },
    runtime: {
      component: 'java-runtime-gamma',
      system: {
        os: OperatingSystems.WINDOWS,
        arch: Architectures.X64,
        osVersion: 'test',
      },
    },
  }) as unknown as Target;

const context = (clientFolder = CLIENT_FOLDER): Context =>
  ({
    client: { slug: SLUG, title: 'Test Client' },
    clientFolder,
    loader: LoaderChoices.VANILLA,
    target: target(clientFolder),
    resolved: {
      memory: { allocatedRamMb: 0 },
      storage: { clientFolder, clientsFolder: 'Z:/clients' },
      launch: { console: false, fullscreen: false },
    },
  }) as unknown as Context;

const composition = (
  directory = CLIENT_FOLDER,
  patch: Partial<LaunchComposition> = {},
): LaunchComposition => ({
  targetId: 'target-id',
  directory,
  javaPath: path.join(directory, 'runtime', 'bin', 'java.exe'),
  mainClass: TEST_MAIN_CLASS,
  jvmArgs: [],
  gameArgs: [],
  classpath: [targetPaths.versionJar(directory, VERSION_ID)],
  nativesDirectory: targetPaths.nativesDir(directory, VERSION_ID),
  auth: { mode: AuthModes.OFFLINE, username: 'tester' },
  workingDirectory: directory,
  ...patch,
});

const createLaunchFixture = async (): Promise<{
  readonly ctx: Context;
  readonly composition: LaunchComposition;
  readonly javaPath: string;
  readonly clientJarPath: string;
}> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'loontail-launch-'));
  tempDirs.push(directory);
  const javaPath = path.join(directory, 'runtime', 'bin', 'java.exe');
  const versionJsonPath = targetPaths.versionJson(directory, VERSION_ID);
  const clientJarPath = targetPaths.versionJar(directory, VERSION_ID);
  await fs.mkdir(path.dirname(javaPath), { recursive: true });
  await fs.mkdir(path.dirname(versionJsonPath), { recursive: true });
  await fs.writeFile(javaPath, 'java');
  await fs.writeFile(versionJsonPath, '{}');
  await fs.writeFile(clientJarPath, 'jar');
  return {
    ctx: context(directory),
    composition: composition(directory, { javaPath, classpath: [clientJarPath] }),
    javaPath,
    clientJarPath,
  };
};

const session = (): LaunchSession => ({
  pid: 1234,
  exited: new Promise<never>(() => undefined),
  abort: vi.fn(),
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

describe('runLaunch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    launchMocks.getStoredAuth.mockReturnValue(null);
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0, tempDirs.length)
        .map((directory) => fs.rm(directory, { recursive: true, force: true })),
    );
  });

  it('cancels startup during compose before creating a process session', async () => {
    let resolveCompose = (_composition: LaunchComposition): void => undefined;
    let resolveComposeStarted = (): void => undefined;
    const composeStarted = new Promise<void>((resolve) => {
      resolveComposeStarted = resolve;
    });
    const compose = vi.fn(
      () =>
        new Promise<LaunchComposition>((resolve) => {
          resolveCompose = resolve;
          resolveComposeStarted();
        }),
    );
    const run = vi.fn();
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;
    const ops = new Map<ClientSlug, Op>();
    const managerEnv = env(kit, ops);

    const launchPromise = runLaunch(managerEnv, SLUG, context(), account());
    await composeStarted;

    const op = ops.get(SLUG);
    expect(op).toEqual(expect.objectContaining({ kind: OpKinds.LAUNCH_STARTING }));
    if (op?.kind !== OpKinds.LAUNCH_STARTING) {
      throw new Error('Expected launch startup operation');
    }

    op.abort.abort();
    resolveCompose(composition());

    await expect(launchPromise).resolves.toBeUndefined();
    expect(run).not.toHaveBeenCalled();
    expect(ops.has(SLUG)).toBe(false);
    expect(managerEnv.emitError).not.toHaveBeenCalled();
    expect(managerEnv.broadcaster.status).toHaveBeenNthCalledWith(1, {
      slug: SLUG,
      status: InstallStatuses.LAUNCHING,
      paused: false,
    });
    expect(managerEnv.broadcaster.status).toHaveBeenLastCalledWith({
      slug: SLUG,
      status: InstallStatuses.INSTALLED,
      paused: false,
    });
  });

  it('passes the startup abort signal to kit launch run', async () => {
    let runOptions: LaunchRunOptions | undefined;
    const fixture = await createLaunchFixture();
    const activeSession = session();
    const compose = vi.fn(async () => fixture.composition);
    const run = vi.fn((_composition: LaunchComposition, options?: LaunchRunOptions) => {
      runOptions = options;
      return activeSession;
    });
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;
    const ops = new Map<ClientSlug, Op>();

    await runLaunch(env(kit, ops), SLUG, fixture.ctx, account());

    expect(runOptions?.signal).toBeInstanceOf(AbortSignal);
    expect(runOptions?.signal?.aborted).toBe(false);
    expect(ops.get(SLUG)).toEqual({
      kind: OpKinds.LAUNCH,
      session: activeSession,
      consoleEnabled: false,
    });
  });

  it('does not spawn when Java disappears between readiness and launch', async () => {
    const fixture = await createLaunchFixture();
    await fs.rm(fixture.javaPath, { force: true });
    const compose = vi.fn(async () => fixture.composition);
    const run = vi.fn();
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;
    const ops = new Map<ClientSlug, Op>();
    const managerEnv = env(kit, ops);

    await expect(runLaunch(managerEnv, SLUG, fixture.ctx, account())).resolves.toBeUndefined();

    expect(run).not.toHaveBeenCalled();
    expect(ops.has(SLUG)).toBe(false);
    expect(managerEnv.emitError).toHaveBeenCalledWith(
      SLUG,
      MinecraftErrorCodes.RUNTIME_ERROR,
      expect.stringContaining('Java executable'),
    );
    expect(managerEnv.broadcaster.status).toHaveBeenLastCalledWith({
      slug: SLUG,
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
    expect(launchMocks.consoleHub.emitState).not.toHaveBeenCalled();
    expect(launchMocks.openConsoleWindow).not.toHaveBeenCalled();
  });

  it('routes a missing launch classpath file back to install state', async () => {
    const fixture = await createLaunchFixture();
    const missingClasspathFile = path.join(
      fixture.composition.directory,
      'libraries',
      'missing.jar',
    );
    const launchComposition = composition(fixture.composition.directory, {
      javaPath: fixture.javaPath,
      classpath: [fixture.clientJarPath, missingClasspathFile],
    });
    const compose = vi.fn(async () => launchComposition);
    const run = vi.fn();
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;
    const ops = new Map<ClientSlug, Op>();
    const managerEnv = env(kit, ops);

    await expect(runLaunch(managerEnv, SLUG, fixture.ctx, account())).resolves.toBeUndefined();

    expect(run).not.toHaveBeenCalled();
    expect(managerEnv.emitError).toHaveBeenCalledWith(
      SLUG,
      MinecraftErrorCodes.NOT_INSTALLED,
      expect.stringContaining('classpath file'),
    );
    expect(managerEnv.broadcaster.status).toHaveBeenLastCalledWith({
      slug: SLUG,
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
  });

  it('adds a launcher HTTP agent before authlib-injector for Yggdrasil sessions', async () => {
    launchMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    const fixture = await createLaunchFixture();
    const compose = vi.fn(async (_target: Target, _options: unknown) => fixture.composition);
    const run = vi.fn(() => session());
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;
    const ops = new Map<ClientSlug, Op>();

    await runLaunch(env(kit, ops), SLUG, fixture.ctx, account());

    const options = compose.mock.calls[0]?.[1] as
      | { readonly extraJvmArgs?: readonly string[]; readonly auth?: unknown }
      | undefined;
    expect(options?.extraJvmArgs?.[0]).toBe('-Dhttp.agent=LoontailLauncher/0.0.0-test');
    expect(options?.extraJvmArgs?.[1]).toContain('authlib-injector-1.2.5.jar');
    expect(options?.extraJvmArgs?.[1]).toContain('=https://auth.test.invalid');
    expect(options?.auth).toEqual(
      expect.objectContaining({
        mode: AuthModes.ONLINE,
        username: 'tester',
        accessToken: 'access-token',
      }),
    );
  });
});
