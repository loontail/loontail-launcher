import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  Architectures,
  AuthModes,
  asMinecraftVersionId,
  type LaunchComposition,
  type LaunchRunOptions,
  type LaunchSession,
  Loaders,
  type MinecraftKit,
  MinecraftKitError,
  MinecraftKitErrorCodes,
  OperatingSystems,
  type Target,
  targetPaths,
} from '@loontail/minecraft-kit';
import type { Context } from '@main/services/minecraft/context';
import type { MinecraftEnv } from '@main/services/minecraft/env';
import { createForgeProcessorCache } from '@main/services/minecraft/forgeProcessorHealing';
import { endLaunch, resolveLaunchAuth, runLaunch } from '@main/services/minecraft/launch';
import { type LaunchStartingOp, type Op, OpKinds } from '@main/services/minecraft/ops';
import { authlibInjectorJarName } from '@main/services/yggdrasil/authlibInjector';
import type { Account } from '@shared/contracts/account';
import type { AuthSession, MojangSession, YggdrasilSession } from '@shared/contracts/auth';
import { type SourceKind, SourceKinds } from '@shared/contracts/catalog';
import { ConsoleStatuses } from '@shared/contracts/console';
import { asCatalogKey, type CatalogKey } from '@shared/contracts/ids';
import { InstallStatuses, MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { LoaderChoices } from '@shared/contracts/settings';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const launchMocks = vi.hoisted(() => {
  return {
    appGetVersion: vi.fn(() => '0.0.0-test'),
    config: {
      yggdrasilApiRoot: 'https://auth.test.invalid',
      networkServiceUrl: undefined as string | undefined,
    },
    getStoredAuth: vi.fn<() => AuthSession | null>(() => null),
    getStoredSessionToken: vi.fn<() => string | null>(() => null),
    recordPlayed: vi.fn<(key: string) => void>(),
    openConsoleWindow: vi.fn(),
    consoleHub: {
      emitState: vi.fn(),
      hasWindow: vi.fn(() => false),
      recordMinecraft: vi.fn(),
      recordSystem: vi.fn(),
      setActiveSession: vi.fn(),
      endSession: vi.fn(),
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
  mainConfig: launchMocks.config,
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
  getStoredSessionToken: launchMocks.getStoredSessionToken,
  recordPlayed: launchMocks.recordPlayed,
}));

// The real authlib-injector jar is fetched at build time and absent while tests
// run, so point the resolver's vendor-dir seam at a stub it can stat.
const AUTHLIB_VENDOR_DIR_ENV = 'LOONTAIL_AUTHLIB_INJECTOR_VENDOR_DIR';
let authlibVendorDir = '';

beforeAll(async () => {
  authlibVendorDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loontail-authlib-'));
  await fs.writeFile(path.join(authlibVendorDir, authlibInjectorJarName()), 'stub');
  process.env[AUTHLIB_VENDOR_DIR_ENV] = authlibVendorDir;
});

afterAll(async () => {
  delete process.env[AUTHLIB_VENDOR_DIR_ENV];
  await fs.rm(authlibVendorDir, { recursive: true, force: true });
});

const KEY = asCatalogKey('official:test-client');
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

const mojangSession = (): MojangSession =>
  ({
    provider: 'mojang',
    accessToken: 'mojang-access-token',
    expiresAt: '2099-01-01T00:00:00Z',
    refreshToken: 'refresh-token',
    clientId: '11111111-1111-1111-1111-111111111111',
    xuid: 'xuid-1',
    profile: {
      username: 'mojang-user',
      uuid: '0123456789abcdef0123456789abcdef',
      skins: [],
    },
  }) as unknown as MojangSession;

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

const CATALOG_KEY = 'local:test-client';

const context = (clientFolder = CLIENT_FOLDER, kind: SourceKind = SourceKinds.OFFICIAL): Context =>
  ({
    item: {
      kind,
      key: CATALOG_KEY,
      spec: { bundleSlug: null },
      presentation: { title: 'Test Client' },
    },
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

const createLaunchFixture = async (
  kind: SourceKind = SourceKinds.OFFICIAL,
): Promise<{
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
    ctx: context(directory, kind),
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
    console: launchMocks.consoleHub,
    openConsole: launchMocks.openConsoleWindow,
    logger: logger(),
    emitStatus: broadcaster.status,
    emitError: vi.fn(),
    persistRuntime: vi.fn(),
    clearRuntimeOverride: vi.fn(),
    resolveBundleRepairFilter: vi.fn(async () => null),
    clearBundleManifest: vi.fn(async () => undefined),
  };
};

describe('runLaunch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    launchMocks.getStoredAuth.mockReturnValue(null);
    launchMocks.getStoredSessionToken.mockReturnValue(null);
    launchMocks.config.networkServiceUrl = undefined;
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
    const ops = new Map<CatalogKey, Op>();
    const managerEnv = env(kit, ops);
    const startupOp: LaunchStartingOp = {
      kind: OpKinds.LAUNCH_STARTING,
      abort: new AbortController(),
    };

    const launchPromise = runLaunch(managerEnv, KEY, context(), account(), startupOp);
    await composeStarted;

    expect(ops.get(KEY)).toBe(startupOp);

    startupOp.abort.abort();
    resolveCompose(composition());

    await expect(launchPromise).resolves.toBeUndefined();
    expect(run).not.toHaveBeenCalled();
    expect(ops.has(KEY)).toBe(false);
    expect(managerEnv.emitError).not.toHaveBeenCalled();
    expect(managerEnv.broadcaster.status).toHaveBeenNthCalledWith(1, {
      key: KEY,
      status: InstallStatuses.LAUNCHING,
      paused: false,
    });
    expect(managerEnv.broadcaster.status).toHaveBeenLastCalledWith({
      key: KEY,
      status: InstallStatuses.INSTALLED,
      paused: false,
    });
  });

  it('honors a cancel issued during the buildContext window (op already aborted before run)', async () => {
    const fixture = await createLaunchFixture();
    const compose = vi.fn(async () => fixture.composition);
    const run = vi.fn(() => session());
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;
    const ops = new Map<CatalogKey, Op>();
    const managerEnv = env(kit, ops);
    // The caller aborts the startup op during its buildContext await; runLaunch
    // must observe the abort after re-registering the op and bail before run.
    const startupOp: LaunchStartingOp = {
      kind: OpKinds.LAUNCH_STARTING,
      abort: new AbortController(),
    };
    startupOp.abort.abort();

    await expect(
      runLaunch(managerEnv, KEY, fixture.ctx, account(), startupOp),
    ).resolves.toBeUndefined();

    expect(run).not.toHaveBeenCalled();
    expect(ops.has(KEY)).toBe(false);
    expect(managerEnv.emitError).not.toHaveBeenCalled();
    expect(managerEnv.broadcaster.status).toHaveBeenLastCalledWith({
      key: KEY,
      status: InstallStatuses.INSTALLED,
      paused: false,
    });
  });

  it('spawns the game session with the caller-supplied startup op when not cancelled', async () => {
    let runOptions: LaunchRunOptions | undefined;
    const fixture = await createLaunchFixture();
    const activeSession = session();
    const compose = vi.fn(async () => fixture.composition);
    const run = vi.fn((_composition: LaunchComposition, options?: LaunchRunOptions) => {
      runOptions = options;
      return activeSession;
    });
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;
    const ops = new Map<CatalogKey, Op>();
    const managerEnv = env(kit, ops);
    const startupOp: LaunchStartingOp = {
      kind: OpKinds.LAUNCH_STARTING,
      abort: new AbortController(),
    };

    await runLaunch(managerEnv, KEY, fixture.ctx, account(), startupOp);

    expect(run).toHaveBeenCalledTimes(1);
    // The kit session is observed against the caller's controller, so a Stop in
    // the spawn window still reaches the same signal the caller can abort.
    expect(runOptions?.signal).toBe(startupOp.abort.signal);
    expect(ops.get(KEY)).toEqual({ kind: OpKinds.LAUNCH, session: activeSession });
    expect(managerEnv.broadcaster.status).toHaveBeenLastCalledWith({
      key: KEY,
      status: InstallStatuses.RUNNING,
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
    const ops = new Map<CatalogKey, Op>();

    await runLaunch(env(kit, ops), KEY, fixture.ctx, account());

    expect(runOptions?.signal).toBeInstanceOf(AbortSignal);
    expect(runOptions?.signal?.aborted).toBe(false);
    expect(ops.get(KEY)).toEqual({
      kind: OpKinds.LAUNCH,
      session: activeSession,
    });
    // Reaching RUNNING stamps the build's last-played time by its CatalogKey.
    expect(launchMocks.recordPlayed).toHaveBeenCalledWith(CATALOG_KEY);
    // The launch flow drives the injected console port (not a module singleton)
    // and never opens a window when the console setting is off.
    expect(launchMocks.consoleHub.setActiveSession).toHaveBeenCalled();
    expect(launchMocks.consoleHub.emitState).toHaveBeenCalledWith(
      expect.objectContaining({ key: KEY, status: ConsoleStatuses.LAUNCHING }),
    );
    expect(launchMocks.openConsoleWindow).not.toHaveBeenCalled();
  });

  it('surfaces a missing Java executable as a repairable launch error, staying installed', async () => {
    const fixture = await createLaunchFixture();
    await fs.rm(fixture.javaPath, { force: true });
    const compose = vi.fn(async () => fixture.composition);
    const run = vi.fn();
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;
    const ops = new Map<CatalogKey, Op>();
    const managerEnv = env(kit, ops);

    await expect(runLaunch(managerEnv, KEY, fixture.ctx, account())).resolves.toBeUndefined();

    expect(run).not.toHaveBeenCalled();
    expect(ops.has(KEY)).toBe(false);
    expect(managerEnv.emitError).toHaveBeenCalledWith(
      KEY,
      MinecraftErrorCodes.RUNTIME_ERROR,
      expect.stringContaining('Java executable'),
    );
    // Stays INSTALLED so the affordance remains "Play"; the failure is surfaced
    // in the console and via a repair toast on the renderer.
    expect(managerEnv.broadcaster.status).toHaveBeenLastCalledWith({
      key: KEY,
      status: InstallStatuses.INSTALLED,
      paused: false,
    });
    expect(launchMocks.consoleHub.recordSystem).toHaveBeenCalledWith(
      expect.stringContaining('Launch check failed'),
      { key: KEY },
    );
    expect(launchMocks.openConsoleWindow).toHaveBeenCalled();
  });

  it('surfaces a missing classpath file as a repairable launch error, staying installed', async () => {
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
    const ops = new Map<CatalogKey, Op>();
    const managerEnv = env(kit, ops);

    await expect(runLaunch(managerEnv, KEY, fixture.ctx, account())).resolves.toBeUndefined();

    expect(run).not.toHaveBeenCalled();
    expect(managerEnv.emitError).toHaveBeenCalledWith(
      KEY,
      MinecraftErrorCodes.NOT_INSTALLED,
      expect.stringContaining('classpath file'),
    );
    expect(managerEnv.broadcaster.status).toHaveBeenLastCalledWith({
      key: KEY,
      status: InstallStatuses.INSTALLED,
      paused: false,
    });
    expect(launchMocks.openConsoleWindow).toHaveBeenCalled();
  });

  it('surfaces an empty classpath as a repairable not-installed error, staying installed', async () => {
    const fixture = await createLaunchFixture();
    const launchComposition = composition(fixture.composition.directory, {
      javaPath: fixture.javaPath,
      classpath: [],
    });
    const compose = vi.fn(async () => launchComposition);
    const run = vi.fn();
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;
    const ops = new Map<CatalogKey, Op>();
    const managerEnv = env(kit, ops);

    await expect(runLaunch(managerEnv, KEY, fixture.ctx, account())).resolves.toBeUndefined();

    expect(run).not.toHaveBeenCalled();
    expect(ops.has(KEY)).toBe(false);
    expect(managerEnv.emitError).toHaveBeenCalledWith(
      KEY,
      MinecraftErrorCodes.NOT_INSTALLED,
      expect.stringContaining('classpath is empty'),
    );
    expect(managerEnv.broadcaster.status).toHaveBeenLastCalledWith({
      key: KEY,
      status: InstallStatuses.INSTALLED,
      paused: false,
    });
  });

  it('rejects an empty-string classpath entry as a repairable not-installed error', async () => {
    const fixture = await createLaunchFixture();
    const launchComposition = composition(fixture.composition.directory, {
      javaPath: fixture.javaPath,
      classpath: ['', fixture.clientJarPath],
    });
    const compose = vi.fn(async () => launchComposition);
    const run = vi.fn();
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;
    const ops = new Map<CatalogKey, Op>();
    const managerEnv = env(kit, ops);

    await expect(runLaunch(managerEnv, KEY, fixture.ctx, account())).resolves.toBeUndefined();

    expect(run).not.toHaveBeenCalled();
    expect(managerEnv.emitError).toHaveBeenCalledWith(
      KEY,
      MinecraftErrorCodes.NOT_INSTALLED,
      expect.stringContaining('empty entry'),
    );
    expect(managerEnv.broadcaster.status).toHaveBeenLastCalledWith({
      key: KEY,
      status: InstallStatuses.INSTALLED,
      paused: false,
    });
  });

  it('surfaces a compose missing-version-JSON kit error as a repairable not-installed error', async () => {
    const fixture = await createLaunchFixture();
    const compose = vi.fn(async () => {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.MANIFEST_NOT_FOUND,
        'Could not find an installed version JSON for target target-id',
        { context: { targetId: 'target-id', loaderType: 'forge' } },
      );
    });
    const run = vi.fn();
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;
    const ops = new Map<CatalogKey, Op>();
    const managerEnv = env(kit, ops);

    await expect(runLaunch(managerEnv, KEY, fixture.ctx, account())).resolves.toBeUndefined();

    expect(run).not.toHaveBeenCalled();
    expect(ops.has(KEY)).toBe(false);
    // A disk-only compose failure must offer a repair, not read as a network error.
    expect(managerEnv.emitError).toHaveBeenCalledWith(
      KEY,
      MinecraftErrorCodes.NOT_INSTALLED,
      expect.stringContaining('installed version JSON'),
    );
    expect(managerEnv.broadcaster.status).toHaveBeenLastCalledWith({
      key: KEY,
      status: InstallStatuses.INSTALLED,
      paused: false,
    });
    expect(launchMocks.consoleHub.recordSystem).toHaveBeenCalledWith(
      expect.stringContaining('Launch check failed'),
      { key: KEY },
    );
  });

  it('maps a compose runtime kit error to a repairable runtime error', async () => {
    const fixture = await createLaunchFixture();
    const compose = vi.fn(async () => {
      throw new MinecraftKitError(MinecraftKitErrorCodes.RUNTIME_NOT_FOUND, 'runtime missing');
    });
    const run = vi.fn();
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;
    const ops = new Map<CatalogKey, Op>();
    const managerEnv = env(kit, ops);

    await expect(runLaunch(managerEnv, KEY, fixture.ctx, account())).resolves.toBeUndefined();

    expect(run).not.toHaveBeenCalled();
    expect(managerEnv.emitError).toHaveBeenCalledWith(
      KEY,
      MinecraftErrorCodes.RUNTIME_ERROR,
      expect.stringContaining('runtime missing'),
    );
  });

  it('adds a launcher HTTP agent before authlib-injector for Yggdrasil sessions', async () => {
    launchMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    const fixture = await createLaunchFixture();
    const compose = vi.fn(async (_target: Target, _options: unknown) => fixture.composition);
    const run = vi.fn(() => session());
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;
    const ops = new Map<CatalogKey, Op>();

    await runLaunch(env(kit, ops), KEY, fixture.ctx, account());

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

  it('injects the network service URL as a -D arg when configured', async () => {
    launchMocks.config.networkServiceUrl = 'https://network.test.invalid';
    const fixture = await createLaunchFixture();
    const compose = vi.fn(async (_target: Target, _options: unknown) => fixture.composition);
    const run = vi.fn(() => session());
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;

    await runLaunch(env(kit, new Map<CatalogKey, Op>()), KEY, fixture.ctx, account());

    const options = compose.mock.calls[0]?.[1] as
      | { readonly extraJvmArgs?: readonly string[] }
      | undefined;
    expect(options?.extraJvmArgs).toEqual(
      expect.arrayContaining(['-Dloontail.network.serviceUrl=https://network.test.invalid']),
    );
  });

  it('omits the network service URL arg when not configured', async () => {
    const fixture = await createLaunchFixture();
    const compose = vi.fn(async (_target: Target, _options: unknown) => fixture.composition);
    const run = vi.fn(() => session());
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;

    await runLaunch(env(kit, new Map<CatalogKey, Op>()), KEY, fixture.ctx, account());

    const options = compose.mock.calls[0]?.[1] as
      | { readonly extraJvmArgs?: readonly string[] }
      | undefined;
    expect(options?.extraJvmArgs ?? []).not.toEqual(
      expect.arrayContaining([expect.stringContaining('loontail.network.serviceUrl')]),
    );
  });

  it('withholds the session token from the game env when no service URL is configured', async () => {
    // The bearer is readable by every class in the game JVM, so it is
    // gated exactly like the URL — no NETWORK_API_URL, no credential handover.
    launchMocks.config.networkServiceUrl = undefined;
    launchMocks.getStoredSessionToken.mockReturnValue('handoff-session-token');
    const fixture = await createLaunchFixture();
    const compose = vi.fn(async (_target: Target, _options: unknown) => fixture.composition);
    let ranComposition: LaunchComposition | undefined;
    const run = vi.fn((composition: LaunchComposition) => {
      ranComposition = composition;
      return session();
    });
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;

    await runLaunch(env(kit, new Map<CatalogKey, Op>()), KEY, fixture.ctx, account());

    expect(ranComposition?.env ?? {}).not.toHaveProperty('LOONTAIL_NETWORK_SERVICE_TOKEN');
  });

  it('withholds the session token from LOCAL builds running unvetted loose mods', async () => {
    launchMocks.config.networkServiceUrl = 'https://network.test.invalid';
    launchMocks.getStoredSessionToken.mockReturnValue('handoff-session-token');
    const fixture = await createLaunchFixture(SourceKinds.LOCAL);
    const compose = vi.fn(async (_target: Target, _options: unknown) => fixture.composition);
    let ranComposition: LaunchComposition | undefined;
    const run = vi.fn((composition: LaunchComposition) => {
      ranComposition = composition;
      return session();
    });
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;

    await runLaunch(env(kit, new Map<CatalogKey, Op>()), KEY, fixture.ctx, account());

    expect(ranComposition?.env ?? {}).not.toHaveProperty('LOONTAIL_NETWORK_SERVICE_TOKEN');
    // The non-secret service URL still rides along.
    const options = compose.mock.calls[0]?.[1] as
      | { readonly extraJvmArgs?: readonly string[] }
      | undefined;
    expect(options?.extraJvmArgs).toEqual(
      expect.arrayContaining(['-Dloontail.network.serviceUrl=https://network.test.invalid']),
    );
  });

  it('hands the session token via the child JVM env, never a -D arg', async () => {
    launchMocks.config.networkServiceUrl = 'https://network.test.invalid';
    launchMocks.getStoredSessionToken.mockReturnValue('handoff-session-token');
    const fixture = await createLaunchFixture();
    let composedJvmArgs: readonly string[] = [];
    const compose = vi.fn(
      async (_target: Target, options: { extraJvmArgs?: readonly string[] }) => {
        composedJvmArgs = options.extraJvmArgs ?? [];
        // Echo the composed JVM args onto the composition so the assertion can prove
        // the token never lands in the launched command line.
        return { ...fixture.composition, jvmArgs: composedJvmArgs };
      },
    );
    let ranComposition: LaunchComposition | undefined;
    const run = vi.fn((composition: LaunchComposition) => {
      ranComposition = composition;
      return session();
    });
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;

    await runLaunch(env(kit, new Map<CatalogKey, Op>()), KEY, fixture.ctx, account());

    // The token is delivered through the spawned process env, not a JVM property.
    expect(ranComposition?.env).toMatchObject({
      LOONTAIL_NETWORK_SERVICE_TOKEN: 'handoff-session-token',
    });
    // It must NOT ride on a -D arg (readable in the OS process list) nor appear in
    // the JVM args / launched command string.
    expect(composedJvmArgs).not.toEqual(
      expect.arrayContaining([expect.stringContaining('loontail.network.serviceToken')]),
    );
    expect(ranComposition?.jvmArgs).not.toEqual(
      expect.arrayContaining([expect.stringContaining('handoff-session-token')]),
    );
    const launchedCommand = [
      ranComposition?.javaPath,
      ...(ranComposition?.jvmArgs ?? []),
      ranComposition?.mainClass,
      ...(ranComposition?.gameArgs ?? []),
    ].join(' ');
    expect(launchedCommand).not.toContain('handoff-session-token');
    // The non-secret service URL still rides on -D (when configured) — unchanged.
  });
});

describe('endLaunch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces the OS exit code from a crash on the console state', () => {
    const ops = new Map<CatalogKey, Op>();
    const managerEnv = env({} as unknown as MinecraftKit, ops);
    const crash = new MinecraftKitError(
      MinecraftKitErrorCodes.LAUNCH_PROCESS_FAILED,
      'Minecraft process exited with code 1',
      { context: { exitCode: 1 } },
    );

    endLaunch(managerEnv, KEY, crash);

    expect(launchMocks.consoleHub.emitState).toHaveBeenCalledWith({
      key: KEY,
      status: ConsoleStatuses.CRASHED,
      message: 'Minecraft process exited with code 1',
      exitCode: 1,
    });
  });

  it('reports a clean exit with the resolved exit code', () => {
    const ops = new Map<CatalogKey, Op>();
    const managerEnv = env({} as unknown as MinecraftKit, ops);

    endLaunch(managerEnv, KEY, undefined, { code: 0, signal: null, aborted: false });

    expect(launchMocks.consoleHub.emitState).toHaveBeenCalledWith({
      key: KEY,
      status: ConsoleStatuses.EXITED,
      exitCode: 0,
    });
    expect(managerEnv.emitError).not.toHaveBeenCalled();
  });

  it('reports a user stop (aborted exit) with a null exit code and no error', () => {
    const ops = new Map<CatalogKey, Op>();
    const managerEnv = env({} as unknown as MinecraftKit, ops);

    endLaunch(managerEnv, KEY, undefined, { code: null, signal: 'SIGTERM', aborted: true });

    expect(launchMocks.consoleHub.emitState).toHaveBeenCalledWith({
      key: KEY,
      status: ConsoleStatuses.EXITED,
      exitCode: null,
    });
    expect(managerEnv.emitError).not.toHaveBeenCalled();
  });
});

describe('resolveLaunchAuth', () => {
  it('maps a yggdrasil session to ONLINE auth with the authlib-injector JVM args', () => {
    const resolved = resolveLaunchAuth(account(), yggdrasilSession());

    expect(resolved.auth).toEqual(
      expect.objectContaining({
        mode: AuthModes.ONLINE,
        username: 'tester',
        accessToken: 'access-token',
      }),
    );
    expect(resolved.extraJvmArgs[0]).toBe('-Dhttp.agent=LoontailLauncher/0.0.0-test');
    expect(resolved.extraJvmArgs[1]).toContain('authlib-injector-1.2.5.jar');
    expect(resolved.extraJvmArgs[1]).toContain('=https://auth.test.invalid');
  });

  it('maps a mojang session to ONLINE auth with no extra JVM args', () => {
    const resolved = resolveLaunchAuth(account(), mojangSession());

    expect(resolved.auth).toEqual(
      expect.objectContaining({
        mode: AuthModes.ONLINE,
        username: 'mojang-user',
        accessToken: 'mojang-access-token',
      }),
    );
    expect(resolved.extraJvmArgs).toEqual([]);
  });

  it('falls back to OFFLINE auth from the account when no session is stored', () => {
    const resolved = resolveLaunchAuth(account(), null);

    expect(resolved.auth).toEqual({ mode: AuthModes.OFFLINE, username: 'tester' });
    expect(resolved.extraJvmArgs).toEqual([]);
  });
});
