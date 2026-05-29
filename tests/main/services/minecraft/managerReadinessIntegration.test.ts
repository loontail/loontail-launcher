import {
  type HttpClient,
  type HttpHeaders,
  type HttpRequestOptions,
  type HttpResponse,
  Loaders,
  type MinecraftKit,
  MinecraftKit as RealMinecraftKit,
  type Target,
  asMinecraftVersionId,
  createMemoryCache,
  silentLogger,
} from '@loontail/minecraft-kit';
import type { Broadcaster } from '@main/services/minecraft/broadcast';
import type { Context } from '@main/services/minecraft/context';
import type { Account } from '@shared/contracts/account';
import { asClientSlug } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { LoaderChoices } from '@shared/contracts/settings';
import { describe, expect, it, vi } from 'vitest';

const readinessMocks = vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
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

import { MinecraftManager } from '@main/services/minecraft/manager';

const SLUG = asClientSlug('vanilla-client');
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
    client: { slug: SLUG, title: 'Vanilla Client' },
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

    await expect(new MinecraftManager(broadcaster(), kit()).getStatus(SLUG)).resolves.toEqual({
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
  });

  it('installs a vanilla target with missing launch files before spawning', async () => {
    const resolvedTarget = target();
    resetMocks(resolvedTarget);

    await new MinecraftManager(broadcaster(), kit()).startLaunch(SLUG, account());

    expect(readinessMocks.runInstall).toHaveBeenCalledWith(
      expect.any(Object),
      SLUG,
      context(resolvedTarget),
      expect.objectContaining({ fresh: true }),
    );
    expect(readinessMocks.runInstall.mock.invocationCallOrder[0]).toBeLessThan(
      readinessMocks.runLaunch.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
