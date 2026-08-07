import type { MinecraftKit } from '@loontail/minecraft-kit';
import {
  createLocalBuild,
  deleteLocalBuild,
  type LocalBuildMutationDeps,
  listLoaderVersionOptions,
  updateLocalBuild,
} from '@main/services/localBuilds/create';
import type { LocalBuildId } from '@shared/contracts/ids';
import type { LocalBuildManifest, LocalBuildRegistryEntry } from '@shared/contracts/localBuild';
import type { LauncherSettings } from '@shared/contracts/settings';
import { describe, expect, it, vi } from 'vitest';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const NOW = '2026-06-07T12:00:00.000Z';
const CLIENTS_FOLDER = 'Z:/clients';

const settings = (clientsFolder = CLIENTS_FOLDER): LauncherSettings => ({
  memory: { allocatedRamMb: 2048 },
  storage: { clientsFolder },
  launch: { console: false, fullscreen: false },
  clients: {},
});

const fakeKit = (overrides: Record<string, unknown> = {}): MinecraftKit =>
  ({
    versions: {
      fabric: {
        resolve: vi.fn(async () => ({ loaderVersion: '0.16.9' })),
        list: vi.fn(async () => [
          { version: '0.16.9', stable: true },
          { version: '0.16.0', stable: false },
        ]),
      },
      forge: {
        resolve: vi.fn(async () => ({ forgeVersion: '47.3.0' })),
        list: vi.fn(async () => [{ forgeVersion: '47.3.0', isRecommended: true }]),
      },
      ...overrides,
    },
  }) as unknown as MinecraftKit;

const captureDeps = () => {
  const saved: { dir: string; manifest: LocalBuildManifest }[] = [];
  const entries: LocalBuildRegistryEntry[] = [];
  const deps: LocalBuildMutationDeps = {
    getSettings: () => settings(),
    newId: () => UUID,
    now: () => NOW,
    saveManifest: async (dir, manifest) => {
      saved.push({ dir, manifest });
    },
    upsertEntry: (entry) => {
      entries.push(entry);
    },
  };
  return { saved, entries, deps };
};

describe('createLocalBuild', () => {
  it('pins the fabric loader version and writes manifest + registry under the install root', async () => {
    const { saved, entries, deps } = captureDeps();
    const item = await createLocalBuild(
      fakeKit(),
      { name: 'Fab', minecraftVersion: '1.21.4', loader: 'fabric' },
      deps,
    );
    expect(item.kind).toBe('local');
    expect(saved[0]?.dir).toBe(`${CLIENTS_FOLDER}/${UUID}`);
    expect(saved[0]?.manifest.loader).toEqual({ type: 'fabric', version: '0.16.9' });
    expect(entries[0]).toEqual({
      id: UUID,
      name: 'Fab',
      dir: `${CLIENTS_FOLDER}/${UUID}`,
      updatedAt: NOW,
    });
  });

  it('trusts a picker-supplied loader version without resolving', async () => {
    const { saved, deps } = captureDeps();
    const kit = fakeKit();
    await createLocalBuild(
      kit,
      { name: 'Pinned', minecraftVersion: '1.21.4', loader: 'forge', loaderVersion: '47.2.0' },
      deps,
    );
    expect(saved[0]?.manifest.loader).toEqual({ type: 'forge', version: '47.2.0' });
    expect(kit.versions.forge.resolve).not.toHaveBeenCalled();
  });

  it('stores a null loader version for vanilla', async () => {
    const { saved, deps } = captureDeps();
    await createLocalBuild(
      fakeKit(),
      { name: 'V', minecraftVersion: '1.21.4', loader: 'vanilla' },
      deps,
    );
    expect(saved[0]?.manifest.loader).toEqual({ type: 'vanilla', version: null });
  });

  it('rejects when the install folder is unset', async () => {
    const { deps } = captureDeps();
    await expect(
      createLocalBuild(
        fakeKit(),
        { name: 'X', minecraftVersion: '1.21.4', loader: 'vanilla' },
        { ...deps, getSettings: () => settings('') },
      ),
    ).rejects.toThrow(/install folder/i);
  });
});

describe('deleteLocalBuild', () => {
  it('removes the registry entry and the build directory', async () => {
    const removeEntry = vi.fn();
    const removeDir = vi.fn(async () => {});
    await deleteLocalBuild(UUID as LocalBuildId, {
      getEntry: () => ({
        id: UUID as LocalBuildId,
        name: 'X',
        dir: `${CLIENTS_FOLDER}/${UUID}`,
        updatedAt: NOW,
      }),
      removeEntry,
      removeDir,
    });
    expect(removeEntry).toHaveBeenCalledWith(UUID);
    expect(removeDir).toHaveBeenCalledWith(`${CLIENTS_FOLDER}/${UUID}`);
  });

  it('still drops the registry entry when no folder is recorded', async () => {
    const removeEntry = vi.fn();
    const removeDir = vi.fn(async () => {});
    await deleteLocalBuild(UUID as LocalBuildId, {
      getEntry: () => undefined,
      removeEntry,
      removeDir,
    });
    expect(removeEntry).toHaveBeenCalledWith(UUID);
    expect(removeDir).not.toHaveBeenCalled();
  });
});

describe('updateLocalBuild', () => {
  const baseManifest: LocalBuildManifest = {
    schema: 1,
    id: UUID as LocalBuildId,
    name: 'Old',
    minecraftVersion: '1.21.4',
    loader: { type: 'vanilla', version: null },
    runtimeVersion: null,
    bundle: { source: 'none' },
    presentation: { description: 'old', icon: null, iconPreset: null, screenshots: [] },
    servers: [],
    origin: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('applies a name + description patch and bumps updatedAt', async () => {
    const writes: LocalBuildManifest[] = [];
    const item = await updateLocalBuild(
      { id: UUID as LocalBuildId, patch: { name: 'New', description: 'fresh' } },
      {
        now: () => '2026-06-08T00:00:00.000Z',
        getEntry: () => ({ id: UUID as LocalBuildId, name: 'Old', dir: 'Z:/x', updatedAt: NOW }),
        loadManifest: async () => baseManifest,
        saveManifest: async (_dir, manifest) => {
          writes.push(manifest);
        },
        upsertEntry: vi.fn(),
      },
    );
    expect(writes[0]?.name).toBe('New');
    expect(writes[0]?.presentation.description).toBe('fresh');
    expect(writes[0]?.updatedAt).toBe('2026-06-08T00:00:00.000Z');
    expect(item.presentation.title).toBe('New');
  });
});

describe('listLoaderVersionOptions', () => {
  it('maps fabric loaders to options', async () => {
    const options = await listLoaderVersionOptions(fakeKit(), {
      loader: 'fabric',
      minecraftVersion: '1.21.4',
    });
    expect(options).toEqual([
      { version: '0.16.9', stable: true },
      { version: '0.16.0', stable: false },
    ]);
  });

  it('returns no loader versions for vanilla', async () => {
    expect(
      await listLoaderVersionOptions(fakeKit(), { loader: 'vanilla', minecraftVersion: '1.21.4' }),
    ).toEqual([]);
  });
});
