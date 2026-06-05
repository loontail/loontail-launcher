import { Loaders, type MinecraftKit, type Target } from '@loontail/minecraft-kit';
import type { Client } from '@shared/contracts/client';
import { asClientSlug } from '@shared/contracts/ids';
import type { LauncherSettings } from '@shared/contracts/settings';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const contextMocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  getSettings: vi.fn(),
  setClientOverride: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => 'Z:/userData',
  },
}));

vi.mock('@main/services/clients', () => ({
  getClient: contextMocks.getClient,
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: contextMocks.getSettings,
  setClientOverride: contextMocks.setClientOverride,
}));

import { buildContext } from '@main/services/minecraft/context';

const SLUG = asClientSlug('runtime-client');
const STALE_RUNTIME_COMPONENT = 'java-runtime-gamma';
const TARGET_RUNTIME_COMPONENT = 'java-runtime-delta';

const launcherSettings = (): LauncherSettings => ({
  memory: { allocatedRamMb: 2048 },
  storage: { clientsFolder: 'Z:/clients' },
  launch: { console: false, fullscreen: false },
  clients: {
    [SLUG]: {
      runtime: {
        component: STALE_RUNTIME_COMPONENT,
        path: 'Z:/userData/runtimes/java-runtime-gamma',
      },
    },
  },
});

const client = (): Client =>
  ({
    slug: SLUG,
    minecraftVersion: '1.20.1',
    runtimeVersion: TARGET_RUNTIME_COMPONENT,
  }) as Client;

const target = (): Target =>
  ({
    loader: { type: Loaders.VANILLA },
    runtime: { component: TARGET_RUNTIME_COMPONENT },
  }) as Target;

describe('buildContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears a persisted runtime ref when the resolved target uses another component', async () => {
    const nextSettings: LauncherSettings = {
      ...launcherSettings(),
      clients: {},
    };
    contextMocks.getClient.mockResolvedValue(client());
    contextMocks.getSettings.mockReturnValue(launcherSettings());
    contextMocks.setClientOverride.mockReturnValue(nextSettings);
    const resolvedTarget = target();
    const kit = {
      targets: {
        resolve: vi.fn(async () => resolvedTarget),
      },
    } as unknown as MinecraftKit;

    const context = await buildContext(kit, SLUG);

    expect(contextMocks.setClientOverride).toHaveBeenCalledWith(SLUG, { runtime: undefined });
    expect(context.target).toBe(resolvedTarget);
    expect(context.resolved.runtime).toBeNull();
  });

  it('routes the stale-runtime fixup through the injected persist dependency', async () => {
    const nextSettings: LauncherSettings = {
      ...launcherSettings(),
      clients: {},
    };
    const injectedGetSettings = vi.fn(() => launcherSettings());
    const injectedPersist = vi.fn(() => nextSettings);
    contextMocks.getClient.mockResolvedValue(client());
    const resolvedTarget = target();
    const kit = {
      targets: { resolve: vi.fn(async () => resolvedTarget) },
    } as unknown as MinecraftKit;

    const context = await buildContext(kit, SLUG, undefined, {
      getSettings: injectedGetSettings,
      persistClientOverride: injectedPersist,
    });

    // The seam is exercised without the module-level settings mock: the stale
    // runtime ref must be cleared via the injected persist, leaving the store
    // untouched (the module mock is never consulted).
    expect(injectedGetSettings).toHaveBeenCalled();
    expect(injectedPersist).toHaveBeenCalledWith(SLUG, { runtime: undefined });
    expect(contextMocks.setClientOverride).not.toHaveBeenCalled();
    expect(context.resolved.runtime).toBeNull();
  });
});
