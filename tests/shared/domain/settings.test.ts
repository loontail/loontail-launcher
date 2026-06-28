import { asCatalogKey } from '@shared/contracts/ids';
import { LoaderChoices } from '@shared/contracts/settings';
import type { LauncherSettings } from '@shared/contracts/settings';
import {
  clearClientOverrides,
  clearStaleClientRuntimeRef,
  defaultLauncherSettings,
  hasClientOverrides,
  joinClientFolder,
  normalizeLauncherSettings,
  pruneClientOverrides,
  resolveClientSettings,
  setClientOverride,
} from '@shared/domain/settings';
import { describe, expect, it } from 'vitest';

const baseSettings = (): LauncherSettings => ({
  memory: { allocatedRamMb: 2048 },
  storage: { clientsFolder: '/games' },
  launch: { console: false, fullscreen: false },
  clients: {},
});

describe('joinClientFolder', () => {
  const UUID = '550e8400-e29b-41d4-a716-446655440000';

  it('returns empty string when clientsFolder is empty', () => {
    expect(joinClientFolder('', asCatalogKey('official:foo'))).toBe('');
  });

  it('derives the folder name from the bare ref, not the CatalogKey', () => {
    expect(joinClientFolder('/games', asCatalogKey('official:survival'))).toBe('/games/survival');
    expect(joinClientFolder('/games', asCatalogKey(`local:${UUID}`))).toBe(`/games/${UUID}`);
  });

  it('preserves trailing forward slash without doubling', () => {
    expect(joinClientFolder('/games/', asCatalogKey('official:survival'))).toBe('/games/survival');
  });

  it('preserves trailing backslash without doubling', () => {
    expect(joinClientFolder('C:\\games\\', asCatalogKey('official:survival'))).toBe(
      'C:\\games\\survival',
    );
  });

  it('falls back to a pre-migration bare key as-is', () => {
    expect(joinClientFolder('/games', asCatalogKey('survival'))).toBe('/games/survival');
  });
});

describe('normalizeLauncherSettings', () => {
  it('returns defaults for non-object input', () => {
    expect(normalizeLauncherSettings(null)).toEqual(defaultLauncherSettings());
    expect(normalizeLauncherSettings(undefined)).toEqual(defaultLauncherSettings());
    expect(normalizeLauncherSettings(42)).toEqual(defaultLauncherSettings());
  });

  it('falls back to defaults for malformed inner sections', () => {
    const result = normalizeLauncherSettings({
      memory: 'not-an-object',
      storage: null,
      launch: 42,
      clients: 'nope',
    });
    expect(result).toEqual(defaultLauncherSettings());
  });

  it('rejects non-integer, negative, and non-finite RAM so the result satisfies its schema', () => {
    const base = defaultLauncherSettings().memory.allocatedRamMb;
    const slug = asCatalogKey('official:main-client');
    for (const bad of [4096.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = normalizeLauncherSettings({
        memory: { allocatedRamMb: bad },
        storage: { clientsFolder: '' },
        launch: { console: false, fullscreen: false },
        clients: { [slug]: { memory: { allocatedRamMb: bad } } },
      });
      expect(result.memory.allocatedRamMb).toBe(base);
      expect(result.clients[slug]).toEqual({});
    }
  });

  it('keeps known fields and discards unknown ones', () => {
    const slug = asCatalogKey('official:main-client');
    const result = normalizeLauncherSettings({
      memory: { allocatedRamMb: 4096, garbage: true },
      storage: { clientsFolder: '/c', other: 1 },
      launch: { console: true, fullscreen: false, junk: 'x' },
      clients: { [slug]: { memory: { allocatedRamMb: 1024 } } },
    });
    expect(result.memory).toEqual({ allocatedRamMb: 4096 });
    expect(result.storage).toEqual({ clientsFolder: '/c' });
    expect(result.launch).toEqual({ console: true, fullscreen: false });
    expect(result.clients[slug]).toEqual({ memory: { allocatedRamMb: 1024 } });
  });

  it('drops invalid runtime overrides and invalid loader choices', () => {
    const slugA = asCatalogKey('official:cl-a');
    const slugB = asCatalogKey('official:cl-b');
    const result = normalizeLauncherSettings({
      memory: { allocatedRamMb: 0 },
      storage: { clientsFolder: '' },
      launch: { console: false, fullscreen: false },
      clients: {
        [slugA]: {
          runtime: { component: 'java-runtime-gamma' /* missing path */ },
          loader: 'nonsense',
        },
        [slugB]: {
          runtime: { component: 'java-runtime-gamma', path: '/jdk' },
          loader: LoaderChoices.FORGE,
        },
      },
    });
    expect(result.clients[slugA]).toEqual({});
    expect(result.clients[slugB]).toEqual({
      runtime: { component: 'java-runtime-gamma', path: '/jdk' },
      loader: LoaderChoices.FORGE,
    });
  });

  it('skips entries with empty / undefined / null slug keys and migrates a bare key', () => {
    const result = normalizeLauncherSettings({
      memory: { allocatedRamMb: 0 },
      storage: { clientsFolder: '' },
      launch: { console: false, fullscreen: false },
      clients: {
        '': { memory: { allocatedRamMb: 1024 } },
        undefined: { memory: { allocatedRamMb: 2048 } },
        null: { memory: { allocatedRamMb: 4096 } },
        good: { memory: { allocatedRamMb: 8192 } },
      },
    });
    // A surviving bare key is lifted onto the official namespace by the migration.
    expect(Object.keys(result.clients)).toEqual(['official:good']);
  });
});

describe('resolveClientSettings', () => {
  it('falls back to global values when no slug is supplied', () => {
    const settings = baseSettings();
    const resolved = resolveClientSettings(settings, null);
    expect(resolved.memory.allocatedRamMb).toBe(2048);
    expect(resolved.storage.clientFolder).toBe('');
    expect(resolved.runtime).toBeNull();
    expect(resolved.loader).toBeNull();
    expect(resolved.diff).toEqual({
      ram: false,
      folder: false,
      console: false,
      fullscreen: false,
    });
  });

  it('returns defaults plus joined folder for an unknown slug', () => {
    const settings = baseSettings();
    const slug = asCatalogKey('official:survival');
    const resolved = resolveClientSettings(settings, slug);
    expect(resolved.storage.clientFolder).toBe('/games/survival');
    expect(resolved.diff.folder).toBe(false);
  });

  it('reports a diff only on fields the override actually changes', () => {
    const slug = asCatalogKey('official:survival');
    const settings: LauncherSettings = {
      ...baseSettings(),
      clients: {
        [slug]: {
          memory: { allocatedRamMb: 8192 },
          launch: { console: true },
          loader: LoaderChoices.FABRIC,
        },
      },
    };
    const resolved = resolveClientSettings(settings, slug);
    expect(resolved.memory.allocatedRamMb).toBe(8192);
    expect(resolved.launch.console).toBe(true);
    expect(resolved.launch.fullscreen).toBe(false);
    expect(resolved.loader).toBe(LoaderChoices.FABRIC);
    expect(resolved.diff).toEqual({
      ram: true,
      folder: false,
      console: true,
      fullscreen: false,
    });
  });

  it('honours a clientFolder override and flags folder diff', () => {
    const slug = asCatalogKey('official:survival');
    const settings: LauncherSettings = {
      ...baseSettings(),
      clients: {
        [slug]: { storage: { clientFolder: '/custom/path' } },
      },
    };
    const resolved = resolveClientSettings(settings, slug);
    expect(resolved.storage.clientFolder).toBe('/custom/path');
    expect(resolved.diff.folder).toBe(true);
  });
});

describe('hasClientOverrides', () => {
  it('returns false for undefined and empty overrides', () => {
    expect(hasClientOverrides(undefined)).toBe(false);
    expect(hasClientOverrides({})).toBe(false);
    expect(hasClientOverrides({ memory: {}, storage: {}, launch: {} })).toBe(false);
  });

  it('returns true once any field has a real value', () => {
    expect(hasClientOverrides({ loader: LoaderChoices.FORGE })).toBe(true);
    expect(hasClientOverrides({ launch: { console: true } })).toBe(true);
  });
});

describe('setClientOverride / clearClientOverrides', () => {
  const slug = asCatalogKey('official:survival');

  it('removes a key whose value matches the global default', () => {
    const settings = baseSettings();
    const next = setClientOverride(settings, slug, { memory: { allocatedRamMb: 2048 } });
    expect(next.clients[slug]).toBeUndefined();
  });

  it('drops the override entirely when nothing remains', () => {
    const settings: LauncherSettings = {
      ...baseSettings(),
      clients: { [slug]: { memory: { allocatedRamMb: 4096 } } },
    };
    const next = setClientOverride(settings, slug, { memory: { allocatedRamMb: 2048 } });
    expect(next.clients[slug]).toBeUndefined();
  });

  it('compacts default-equivalent folder and launch overrides', () => {
    const settings: LauncherSettings = {
      ...baseSettings(),
      clients: {
        [slug]: {
          storage: { clientFolder: '/custom/path' },
          launch: { console: true, fullscreen: true },
          loader: LoaderChoices.FORGE,
        },
      },
    };
    const next = setClientOverride(settings, slug, {
      storage: { clientFolder: '/games/survival' },
      launch: { console: false, fullscreen: false },
    });
    expect(next.clients[slug]).toEqual({ loader: LoaderChoices.FORGE });
  });

  it('clears all overrides but preserves the runtime ref', () => {
    const settings: LauncherSettings = {
      ...baseSettings(),
      clients: {
        [slug]: {
          memory: { allocatedRamMb: 4096 },
          runtime: { component: 'java-runtime-gamma', path: '/jdk' },
        },
      },
    };
    const next = clearClientOverrides(settings, slug);
    expect(next.clients[slug]).toEqual({
      runtime: { component: 'java-runtime-gamma', path: '/jdk' },
    });
  });

  it('drops the override slot completely when no runtime ref is set', () => {
    const settings: LauncherSettings = {
      ...baseSettings(),
      clients: { [slug]: { memory: { allocatedRamMb: 4096 } } },
    };
    const next = clearClientOverrides(settings, slug);
    expect(next.clients[slug]).toBeUndefined();
  });

  it('is a no-op when the slug has no override', () => {
    const settings = baseSettings();
    expect(clearClientOverrides(settings, slug)).toBe(settings);
  });

  it('clears a stale runtime ref when the target component changes', () => {
    const settings: LauncherSettings = {
      ...baseSettings(),
      clients: {
        [slug]: {
          runtime: { component: 'java-runtime-gamma', path: '/jdk/gamma' },
          memory: { allocatedRamMb: 4096 },
        },
      },
    };
    const next = clearStaleClientRuntimeRef(settings, slug, 'java-runtime-delta');

    expect(next.clients[slug]).toEqual({ memory: { allocatedRamMb: 4096 } });
  });

  it('keeps a runtime ref when the target component still matches', () => {
    const settings: LauncherSettings = {
      ...baseSettings(),
      clients: {
        [slug]: {
          runtime: { component: 'java-runtime-gamma', path: '/jdk/gamma' },
        },
      },
    };

    expect(clearStaleClientRuntimeRef(settings, slug, 'java-runtime-gamma')).toBe(settings);
  });
});

describe('pruneClientOverrides', () => {
  it('returns the same reference when nothing needs to be pruned', () => {
    const slug = asCatalogKey('official:survival');
    const settings: LauncherSettings = {
      ...baseSettings(),
      clients: { [slug]: { memory: { allocatedRamMb: 4096 } } },
    };
    const keep = new Set<string>([slug]);
    expect(pruneClientOverrides(settings, keep)).toBe(settings);
  });

  it('removes overrides for slugs not in the keep set', () => {
    const keepSlug = asCatalogKey('official:kept');
    const dropSlug = asCatalogKey('official:gone');
    const settings: LauncherSettings = {
      ...baseSettings(),
      clients: {
        [keepSlug]: { memory: { allocatedRamMb: 4096 } },
        [dropSlug]: { launch: { console: true } },
      },
    };
    const next = pruneClientOverrides(settings, new Set([keepSlug]));
    expect(Object.keys(next.clients)).toEqual([keepSlug]);
  });

  it('keeps a known local build override while pruning an orphaned official one', () => {
    const localKey = asCatalogKey('local:550e8400-e29b-41d4-a716-446655440000');
    const orphanOfficial = asCatalogKey('official:gone');
    const settings: LauncherSettings = {
      ...baseSettings(),
      clients: {
        [localKey]: { loader: LoaderChoices.FABRIC },
        [orphanOfficial]: { memory: { allocatedRamMb: 4096 } },
      },
    };
    // The sweep builds the keep-set from official + local CatalogKeys; a local
    // build in that set must survive even though no Strapi slug matches it.
    const next = pruneClientOverrides(settings, new Set([localKey]));
    expect(Object.keys(next.clients)).toEqual([localKey]);
  });
});
