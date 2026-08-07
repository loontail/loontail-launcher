import {
  asMinecraftVersionId,
  createMemoryCache,
  type HttpClient,
  type HttpHeaders,
  type HttpRequestOptions,
  type HttpResponse,
  Loaders,
  type MinecraftKit,
  MinecraftKit as RealMinecraftKit,
  silentLogger,
  type Target,
} from '@loontail/minecraft-kit';
import type { Broadcaster } from '@main/services/minecraft/broadcast';
import type { Context } from '@main/services/minecraft/context';
import type { Account } from '@shared/contracts/account';
import { asCatalogKey } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { LoaderChoices } from '@shared/contracts/settings';
import { describe, expect, it, vi } from 'vitest';

const readinessMocks = vi.hoisted(() => {
  return {
    buildContext: vi.fn(),
    getSettings: vi.fn(),
    runInstall: vi.fn(),
    runLaunch: vi.fn(),
    setClientOverride: vi.fn(),
  };
});

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@main/services/minecraft/context', () => ({
  buildContext: readinessMocks.buildContext,
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: readinessMocks.getSettings,
  setClientOverride: readinessMocks.setClientOverride,
}));

vi.mock('@main/services/minecraft/install', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/minecraft/install')>();
  return { ...actual, runInstall: readinessMocks.runInstall };
});

vi.mock('@main/services/minecraft/launch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/minecraft/launch')>();
  return { ...actual, runLaunch: readinessMocks.runLaunch };
});

import { createClientOperationLocks } from '@main/services/clientOperationLocks';
import { MinecraftManager } from '@main/services/minecraft/manager';
import { OpKinds, type OpMap } from '@main/services/minecraft/ops';
import {
  stubClearBundleManifest,
  stubConsoleSink,
  stubOpenConsole,
  stubResolveBuild,
  stubResolveBundleRepairFilter,
} from './managerStubs';

const KEY = asCatalogKey('official:vanilla-client');
const CLIENT_FOLDER = 'Z:/clients/vanilla-client';
const MC_VERSION = asMinecraftVersionId('1.20.1');

class FakeHttpClient implements HttpClient {
  private readonly bodies = new Map<string, string>();

  on(url: string, body: string): this {
    this.bodies.set(url, body);
    return this;
  }

  async request(url: string, _options?: HttpRequestOptions): Promise<HttpResponse> {
    const body = this.bodies.get(url);
    if (body === undefined) {
      throw new Error(`Unmocked URL: ${url}`);
    }
    const bytes = new TextEncoder().encode(body);
    const headers: HttpHeaders = {};
    return {
      status: 200,
      headers,
      url,
      async text() {
        return body;
      },
      async json<T = unknown>() {
        return JSON.parse(body) as T;
      },
      async bytes() {
        return bytes;
      },
      async *stream() {
        yield bytes;
      },
    };
  }
}

const account = (): Account => ({
  provider: 'yggdrasil',
  username: 'tester',
  email: null,
  skin: null,
  cape: null,
});

const target = (): Target => {
  const minecraft: Target['minecraft'] = {
    version: MC_VERSION,
    channel: 'release',
    manifest: {
      id: MC_VERSION,
      type: 'release',
      mainClass: 'net.minecraft.client.main.Main',
      assetIndex: { id: '5', sha1: 'x', size: 1, totalSize: 1, url: 'https://idx/' },
      assets: '5',
      downloads: { client: { sha1: 'abc', size: 1, url: 'https://client/' } },
      libraries: [],
      javaVersion: { component: 'java-runtime-gamma', majorVersion: 17 },
    },
    summary: {
      id: MC_VERSION,
      type: 'release',
      url: '',
      time: '',
      releaseTime: '',
      sha1: '',
      complianceLevel: 1,
    },
  };
  return {
    id: 'vanilla-client',
    directory: CLIENT_FOLDER,
    minecraft,
    loader: { type: Loaders.VANILLA, minecraftVersion: '1.20.1', minecraft },
    runtime: {
      component: 'java-runtime-gamma',
      platformKey: 'windows-x64',
      versionName: '17.0.8',
      majorVersion: 17,
      system: { os: 'windows', arch: 'x64', osVersion: '10.0' },
      manifestUrl: 'https://rm/',
      manifestSha1: 'x',
    },
  };
};

const context = (resolvedTarget: Target): Context =>
  ({
    item: { spec: { bundleSlug: null }, presentation: { title: 'Vanilla Client' } },
    clientFolder: CLIENT_FOLDER,
    loader: LoaderChoices.VANILLA,
    target: resolvedTarget,
    resolved: {
      memory: { allocatedRamMb: 0 },
      storage: { clientFolder: CLIENT_FOLDER, clientsFolder: 'Z:/clients' },
      launch: { console: false, fullscreen: false },
    },
  }) as unknown as Context;

const kit = (): MinecraftKit => {
  const http = new FakeHttpClient()
    .on('https://idx/', '{"objects":{}}')
    .on('https://rm/', '{"files":{}}');
  return new RealMinecraftKit({
    httpClient: http,
    cache: createMemoryCache(),
    logger: silentLogger,
    system: { os: 'windows', arch: 'x64', osVersion: '10.0' },
  });
};

const broadcaster = (): Broadcaster =>
  ({
    status: vi.fn(),
    progress: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
  }) as unknown as Broadcaster;

const resetMocks = (resolvedTarget: Target): void => {
  readinessMocks.buildContext.mockReset();
  readinessMocks.getSettings.mockReset();
  readinessMocks.runInstall.mockReset();
  readinessMocks.runLaunch.mockReset();
  readinessMocks.setClientOverride.mockReset();

  readinessMocks.buildContext.mockResolvedValue(context(resolvedTarget));
  readinessMocks.getSettings.mockReturnValue({
    memory: { allocatedRamMb: 0 },
    storage: { clientsFolder: 'Z:/clients' },
    launch: { console: false, fullscreen: false },
    clients: {},
  });
  readinessMocks.runInstall.mockResolvedValue(undefined);
  readinessMocks.runLaunch.mockResolvedValue(undefined);
};

describe('MinecraftManager readiness integration', () => {
  it('seeds not-installed status for a vanilla target with no client jar', async () => {
    const resolvedTarget = target();
    resetMocks(resolvedTarget);

    await expect(
      new MinecraftManager(
        broadcaster(),
        kit(),
        createClientOperationLocks(),
        stubConsoleSink(),
        stubOpenConsole(),
        () => account(),
        stubResolveBundleRepairFilter(),
        stubClearBundleManifest(),
        stubResolveBuild(),
      ).getStatus(KEY),
    ).resolves.toEqual({
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
  });

  it('seeds status without touching the kit (no verify, no target resolve on open)', async () => {
    const resolvedTarget = target();
    resetMocks(resolvedTarget);
    // Opening the launcher must resolve installability from local files alone:
    // any access to kit.verify or kit.targets during the status seed is a
    // regression (hashing or network on open).
    const throwOnUse = (surface: string): unknown =>
      new Proxy(
        {},
        {
          get() {
            throw new Error(`getStatus must not use kit.${surface}`);
          },
        },
      );
    const guardedKit = {
      verify: throwOnUse('verify'),
      targets: throwOnUse('targets'),
    } as unknown as MinecraftKit;

    await expect(
      new MinecraftManager(
        broadcaster(),
        guardedKit,
        createClientOperationLocks(),
        stubConsoleSink(),
        stubOpenConsole(),
        () => account(),
        stubResolveBundleRepairFilter(),
        stubClearBundleManifest(),
        stubResolveBuild(),
      ).getStatus(KEY),
    ).resolves.toEqual({
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
  });

  it('launches without an implicit reinstall — the lenient preflight guards launchability', async () => {
    const resolvedTarget = target();
    resetMocks(resolvedTarget);

    const currentAccount = account();
    await new MinecraftManager(
      broadcaster(),
      kit(),
      createClientOperationLocks(),
      stubConsoleSink(),
      stubOpenConsole(),
      () => currentAccount,
      stubResolveBundleRepairFilter(),
      stubClearBundleManifest(),
      stubResolveBuild(),
    ).startLaunch(KEY);

    expect(readinessMocks.runInstall).not.toHaveBeenCalled();
    expect(readinessMocks.runLaunch).toHaveBeenCalledWith(
      expect.any(Object),
      KEY,
      context(resolvedTarget),
      account(),
    );
  });
});

// Drives the full install -> post-install bundle sync -> launch lifecycle through
// the public API against the REAL op Map and asserts it never holds more than one
// op per key across the transitions: each phase replaces the prior op rather than
// stacking, and every phase clears itself.
describe('MinecraftManager install -> launch op-per-key invariant (real op map)', () => {
  it('keeps exactly one op per key across install, bundle sync, and launch', async () => {
    const resolvedTarget = target();
    resetMocks(resolvedTarget);

    const ops: OpMap = new Map();
    const sizeOf = (map: OpMap): number => map.size;

    const installHookKinds: Array<string | undefined> = [];
    const launchHookKinds: Array<string | undefined> = [];
    let phase: 'install' | 'launch' = 'install';
    const hook = vi.fn(async () => {
      // While a bundle sync is in flight the registry must carry the single
      // BUNDLE_SYNCING op for the key — never a second stacked op.
      const recorded = phase === 'install' ? installHookKinds : launchHookKinds;
      recorded.push(ops.get(KEY)?.kind);
      expect(sizeOf(ops)).toBe(1);
    });

    const manager = new MinecraftManager(
      broadcaster(),
      kit(),
      createClientOperationLocks(),
      stubConsoleSink(),
      stubOpenConsole(),
      () => account(),
      stubResolveBundleRepairFilter(),
      stubClearBundleManifest(),
      stubResolveBuild(),
      ops,
    );
    manager.attachLaunchHook(hook);

    await manager.startInstall(KEY);
    await vi.waitFor(() => {
      expect(installHookKinds).toHaveLength(1);
    });
    // The post-install bundle sync ran under a BUNDLE_SYNCING op and then cleared
    // it, so the key is idle and a follow-up launch passes requireIdle.
    expect(installHookKinds).toEqual([OpKinds.BUNDLE_SYNCING]);
    await vi.waitFor(() => {
      expect(sizeOf(ops)).toBe(0);
    });

    phase = 'launch';
    await manager.startLaunch(KEY);
    await vi.waitFor(() => {
      expect(launchHookKinds).toHaveLength(1);
    });
    // The pre-launch bundle sync ran under its own single BUNDLE_SYNCING op and
    // handed off to runLaunch, which leaves no op behind in this mocked launch.
    expect(launchHookKinds).toEqual([OpKinds.BUNDLE_SYNCING]);
    expect(readinessMocks.runLaunch).toHaveBeenCalledTimes(1);
    expect(sizeOf(ops)).toBe(0);
  });
});
