import { Loaders, type MinecraftKit, type Target } from '@loontail/minecraft-kit';
import type { CatalogItem } from '@shared/contracts/catalog';
import type { Client } from '@shared/contracts/client';
import { asCatalogKey, asClientSlug } from '@shared/contracts/ids';
import type { LauncherSettings } from '@shared/contracts/settings';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLauncherSettings } from '../../../helpers/fixtures';

const contextMocks = vi.hoisted(() => ({
  resolveBuild: vi.fn(),
  getSettings: vi.fn(),
  setClientOverride: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => 'Z:/userData',
  },
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: contextMocks.getSettings,
  setClientOverride: contextMocks.setClientOverride,
}));

import { buildContext } from '@main/services/minecraft/context';

// The operational id over IPC is a CatalogKey; this build is official, so its
// key is `official:runtime-client`. The on-disk folder must still be the bare
// ref `runtime-client` (folder-naming decouple), asserted below.
const SLUG = asCatalogKey('official:runtime-client');
const STRAPI_SLUG = asClientSlug('runtime-client');
const STALE_RUNTIME_COMPONENT = 'java-runtime-gamma';
const TARGET_RUNTIME_COMPONENT = 'java-runtime-delta';

const launcherSettings = (): LauncherSettings =>
  makeLauncherSettings({
    memory: { allocatedRamMb: 2048 },
    storage: { clientsFolder: 'Z:/clients' },
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
    slug: STRAPI_SLUG,
    minecraftVersion: '1.20.1',
    runtimeVersion: TARGET_RUNTIME_COMPONENT,
  }) as Client;

const officialItem = (): CatalogItem =>
  ({
    kind: 'official',
    key: SLUG,
    ref: { source: 'official', slug: STRAPI_SLUG },
    spec: {
      minecraftVersion: '1.20.1',
      forgeVersion: null,
      fabricVersion: null,
      runtimeVersion: TARGET_RUNTIME_COMPONENT,
      bundleSlug: null,
    },
    presentation: { title: 'Runtime Client' },
    raw: client(),
  }) as unknown as CatalogItem;

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
    contextMocks.resolveBuild.mockResolvedValue(officialItem());
    contextMocks.getSettings.mockReturnValue(launcherSettings());
    contextMocks.setClientOverride.mockReturnValue(nextSettings);
    const resolvedTarget = target();
    const kit = {
      targets: {
        resolve: vi.fn(async () => resolvedTarget),
      },
    } as unknown as MinecraftKit;

    const context = await buildContext(kit, SLUG, undefined, {
      resolveBuild: contextMocks.resolveBuild,
    });

    expect(contextMocks.setClientOverride).toHaveBeenCalledWith(SLUG, { runtime: undefined });
    expect(context.target).toBe(resolvedTarget);
    // The fixup re-resolves settings whose stale override was dropped, so the
    // narrowed slice reflects the default-derived client folder.
    expect(context.resolved.storage.clientFolder).toBe('Z:/clients/runtime-client');
  });

  it('routes the stale-runtime fixup through the injected persist dependency', async () => {
    const nextSettings: LauncherSettings = {
      ...launcherSettings(),
      clients: {},
    };
    const injectedGetSettings = vi.fn(() => launcherSettings());
    const injectedPersist = vi.fn(() => nextSettings);
    contextMocks.resolveBuild.mockResolvedValue(officialItem());
    const resolvedTarget = target();
    const kit = {
      targets: { resolve: vi.fn(async () => resolvedTarget) },
    } as unknown as MinecraftKit;

    const context = await buildContext(kit, SLUG, undefined, {
      getSettings: injectedGetSettings,
      persistClientOverride: injectedPersist,
      resolveBuild: contextMocks.resolveBuild,
    });

    // The seam is exercised without the module-level settings mock: the stale
    // runtime ref must be cleared via the injected persist, leaving the store
    // untouched (the module mock is never consulted).
    expect(injectedGetSettings).toHaveBeenCalled();
    expect(injectedPersist).toHaveBeenCalledWith(SLUG, { runtime: undefined });
    expect(contextMocks.setClientOverride).not.toHaveBeenCalled();
    expect(context.resolved.storage.clientFolder).toBe('Z:/clients/runtime-client');
  });
});
