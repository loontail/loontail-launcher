import {
  AuthModes,
  type LaunchComposition,
  type LaunchRunOptions,
  type LaunchSession,
  type MinecraftKit,
  type Target,
} from '@loontail/minecraft-kit';
import type { Context } from '@main/services/minecraft/context';
import type { ManagerEnv } from '@main/services/minecraft/env';
import { runLaunch } from '@main/services/minecraft/launch';
import { type Op, OpKinds } from '@main/services/minecraft/ops';
import type { Account } from '@shared/contracts/account';
import { type ClientSlug, asClientSlug } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { LoaderChoices } from '@shared/contracts/settings';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const launchMocks = vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
  return {
    appGetVersion: vi.fn(() => '0.0.0-test'),
    getStoredAuth: vi.fn(() => null),
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
const TARGET = {} as Target;

const account = (): Account => ({
  provider: 'yggdrasil',
  username: 'tester',
  email: null,
  skin: null,
  cape: null,
});

const context = (): Context =>
  ({
    client: { slug: SLUG, title: 'Test Client' },
    clientFolder: CLIENT_FOLDER,
    loader: LoaderChoices.VANILLA,
    target: TARGET,
    resolved: {
      memory: { allocatedRamMb: 0 },
      storage: { clientFolder: CLIENT_FOLDER, clientsFolder: 'Z:/clients' },
      launch: { console: false, fullscreen: false },
    },
  }) as unknown as Context;

const composition = (): LaunchComposition => ({
  targetId: 'target-id',
  directory: CLIENT_FOLDER,
  javaPath: 'java',
  mainClass: 'net.minecraft.client.main.Main',
  jvmArgs: [],
  gameArgs: [],
  classpath: [],
  nativesDirectory: 'natives',
  auth: { mode: AuthModes.OFFLINE, username: 'tester' },
  workingDirectory: CLIENT_FOLDER,
});

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
    const activeSession = session();
    const compose = vi.fn(async () => composition());
    const run = vi.fn((_composition: LaunchComposition, options?: LaunchRunOptions) => {
      runOptions = options;
      return activeSession;
    });
    const kit = { launch: { compose, run } } as unknown as MinecraftKit;
    const ops = new Map<ClientSlug, Op>();

    await runLaunch(env(kit, ops), SLUG, context(), account());

    expect(runOptions?.signal).toBeInstanceOf(AbortSignal);
    expect(runOptions?.signal?.aborted).toBe(false);
    expect(ops.get(SLUG)).toEqual({
      kind: OpKinds.LAUNCH,
      session: activeSession,
      consoleEnabled: false,
    });
  });
});
