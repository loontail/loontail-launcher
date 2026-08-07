import { randomUUID } from 'node:crypto';
import type { MinecraftKit } from '@loontail/minecraft-kit';
import { MinecraftChannels } from '@loontail/minecraft-kit';
import { getSettings as defaultGetSettings } from '@main/services/settings/settings';
import type { LocalCatalogItem } from '@shared/contracts/catalog';
import { localKey } from '@shared/contracts/catalog';
import type { LocalBuildId } from '@shared/contracts/ids';
import { asLocalBuildId } from '@shared/contracts/ids';
import {
  type CreateBuildPayload,
  INSTANCE_MANIFEST_SCHEMA_VERSION,
  type ListLoaderVersionsArgs,
  type LoaderVersionOption,
  type LocalBuildManifest,
  LocalBuildManifestSchema,
  type MinecraftVersionOption,
  type UpdateBuildPayload,
} from '@shared/contracts/localBuild';
import { LoaderChoices } from '@shared/contracts/settings';
import { resolveClientSettings } from '@shared/domain/settings';
import {
  loadLocalBuildManifest,
  removeLocalBuildDir,
  saveLocalBuildManifest,
} from './localBuildRepo';
import { manifestToCatalogItem } from './localSource';
import { getLocalBuildEntry, removeLocalBuildEntry, upsertLocalBuildEntry } from './registry';

// Side-effecting collaborators are injectable so create/update/delete can be
// unit-tested without the store or the filesystem.
export type LocalBuildMutationDeps = {
  getSettings?: typeof defaultGetSettings;
  newId?: () => string;
  now?: () => string;
  saveManifest?: typeof saveLocalBuildManifest;
  loadManifest?: typeof loadLocalBuildManifest;
  upsertEntry?: typeof upsertLocalBuildEntry;
  removeEntry?: typeof removeLocalBuildEntry;
  getEntry?: typeof getLocalBuildEntry;
  removeDir?: typeof removeLocalBuildDir;
};

export class LocalBuildError extends Error {}

const resolveLocalBuildDir = (getSettings: typeof defaultGetSettings, id: LocalBuildId): string => {
  // Resolve settings by the build's CatalogKey (`local:<uuid>`); the folder-naming
  // decouple in joinClientFolder strips the prefix so the on-disk default stays
  // `<clientsFolder>/<uuid>`, never `<clientsFolder>/local:<uuid>`.
  const folder = resolveClientSettings(getSettings(), localKey(id)).storage.clientFolder;
  if (!folder) {
    throw new LocalBuildError('Set the launcher install folder in System settings first');
  }
  return folder;
};

// Pin a concrete loader version at create time. A picker-supplied version is
// trusted as-is (offline); otherwise the kit resolves the recommended/latest
// build (network). Vanilla has no loader version. Pinning keeps the catalog's
// loader inference (forge/fabric from a non-null version) unambiguous.
const pinLoaderVersion = async (
  kit: MinecraftKit,
  payload: CreateBuildPayload,
): Promise<string | null> => {
  if (payload.loader === LoaderChoices.FABRIC) {
    if (payload.loaderVersion) return payload.loaderVersion;
    const resolved = await kit.versions.fabric.resolve({
      minecraftVersion: payload.minecraftVersion,
    });
    return resolved.loaderVersion;
  }
  if (payload.loader === LoaderChoices.FORGE) {
    if (payload.loaderVersion) return payload.loaderVersion;
    const resolved = await kit.versions.forge.resolve({
      minecraftVersion: payload.minecraftVersion,
    });
    return resolved.forgeVersion;
  }
  return null;
};

export const createLocalBuild = async (
  kit: MinecraftKit,
  payload: CreateBuildPayload,
  deps: LocalBuildMutationDeps = {},
): Promise<LocalCatalogItem> => {
  const getSettings = deps.getSettings ?? defaultGetSettings;
  const newId = deps.newId ?? randomUUID;
  const now = deps.now ?? (() => new Date().toISOString());
  const saveManifest = deps.saveManifest ?? saveLocalBuildManifest;
  const upsertEntry = deps.upsertEntry ?? upsertLocalBuildEntry;

  const id = asLocalBuildId(newId());
  const dir = resolveLocalBuildDir(getSettings, id);
  const loaderVersion = await pinLoaderVersion(kit, payload);
  const timestamp = now();

  const manifest: LocalBuildManifest = LocalBuildManifestSchema.parse({
    schema: INSTANCE_MANIFEST_SCHEMA_VERSION,
    id,
    name: payload.name,
    minecraftVersion: payload.minecraftVersion,
    loader: { type: payload.loader, version: loaderVersion },
    runtimeVersion: payload.runtimeVersion ?? null,
    presentation: {
      description: '',
      icon: null,
      iconPreset: payload.iconPreset ?? null,
      screenshots: [],
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await saveManifest(dir, manifest);
  upsertEntry({ id, name: manifest.name, dir, updatedAt: manifest.updatedAt });
  return manifestToCatalogItem(manifest, dir);
};

export const updateLocalBuild = async (
  payload: UpdateBuildPayload,
  deps: LocalBuildMutationDeps = {},
): Promise<LocalCatalogItem> => {
  const now = deps.now ?? (() => new Date().toISOString());
  const loadManifest = deps.loadManifest ?? loadLocalBuildManifest;
  const saveManifest = deps.saveManifest ?? saveLocalBuildManifest;
  const upsertEntry = deps.upsertEntry ?? upsertLocalBuildEntry;
  const getEntry = deps.getEntry ?? getLocalBuildEntry;

  const entry = getEntry(payload.id);
  if (!entry) throw new LocalBuildError(`Local build "${payload.id}" not found`);
  const existing = await loadManifest(entry.dir);
  if (!existing) throw new LocalBuildError(`Local build "${payload.id}" has no readable manifest`);

  const next: LocalBuildManifest = {
    ...existing,
    ...(payload.patch.name !== undefined ? { name: payload.patch.name } : {}),
    presentation:
      payload.patch.description !== undefined
        ? { ...existing.presentation, description: payload.patch.description }
        : existing.presentation,
    updatedAt: now(),
  };

  await saveManifest(entry.dir, next);
  upsertEntry({ id: next.id, name: next.name, dir: entry.dir, updatedAt: next.updatedAt });
  return manifestToCatalogItem(next, entry.dir);
};

export const deleteLocalBuild = async (
  id: LocalBuildId,
  deps: LocalBuildMutationDeps = {},
): Promise<void> => {
  const getEntry = deps.getEntry ?? getLocalBuildEntry;
  const removeEntry = deps.removeEntry ?? removeLocalBuildEntry;
  const removeDir = deps.removeDir ?? removeLocalBuildDir;

  const entry = getEntry(id);
  // Drop the index entry first so a failed dir removal can't leave a dangling
  // catalog row; the registry is the source of "what exists" for the listing.
  removeEntry(id);
  if (entry) await removeDir(entry.dir);
};

export const listMinecraftVersionOptions = async (
  kit: MinecraftKit,
): Promise<MinecraftVersionOption[]> => {
  const versions = await kit.versions.minecraft.list({ channel: MinecraftChannels.RELEASE });
  return versions.map((summary) => ({ id: summary.id, type: summary.type }));
};

export const listLoaderVersionOptions = async (
  kit: MinecraftKit,
  args: ListLoaderVersionsArgs,
): Promise<LoaderVersionOption[]> => {
  if (args.loader === LoaderChoices.FABRIC) {
    const loaders = await kit.versions.fabric.list({ minecraftVersion: args.minecraftVersion });
    return loaders.map((loader) => ({ version: loader.version, stable: loader.stable }));
  }
  if (args.loader === LoaderChoices.FORGE) {
    const builds = await kit.versions.forge.list({ minecraftVersion: args.minecraftVersion });
    return builds.map((build) => ({
      version: build.forgeVersion,
      recommended: build.isRecommended,
    }));
  }
  return [];
};
