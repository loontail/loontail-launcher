import { randomUUID } from 'node:crypto';
import type { MinecraftKit } from '@loontail/minecraft-kit';
import { MinecraftChannels } from '@loontail/minecraft-kit';
import { getSettings as defaultGetSettings } from '@main/services/settings/settings';
import type { LocalCatalogItem } from '@shared/contracts/catalog';
import type { ClientSlug, InstanceId } from '@shared/contracts/ids';
import { asInstanceId } from '@shared/contracts/ids';
import {
  type CreateInstancePayload,
  INSTANCE_MANIFEST_SCHEMA_VERSION,
  type InstanceManifest,
  InstanceManifestSchema,
  type ListLoaderVersionsArgs,
  type LoaderVersionOption,
  type MinecraftVersionOption,
  type UpdateInstancePayload,
} from '@shared/contracts/instance';
import { LoaderChoices } from '@shared/contracts/settings';
import { resolveClientSettings } from '@shared/domain/settings';
import { loadInstanceManifest, removeInstanceDir, saveInstanceManifest } from './instanceRepo';
import { manifestToCatalogItem } from './localSource';
import { getInstanceEntry, removeInstanceEntry, upsertInstanceEntry } from './registry';

// Side-effecting collaborators are injectable so create/update/delete can be
// unit-tested without electron-store or the filesystem.
export type InstanceMutationDeps = {
  getSettings?: typeof defaultGetSettings;
  newId?: () => string;
  now?: () => string;
  saveManifest?: typeof saveInstanceManifest;
  loadManifest?: typeof loadInstanceManifest;
  upsertEntry?: typeof upsertInstanceEntry;
  removeEntry?: typeof removeInstanceEntry;
  getEntry?: typeof getInstanceEntry;
  removeDir?: typeof removeInstanceDir;
};

export class InstanceError extends Error {}

const resolveInstanceDir = (getSettings: typeof defaultGetSettings, id: InstanceId): string => {
  const folder = resolveClientSettings(getSettings(), id as unknown as ClientSlug).storage
    .clientFolder;
  if (!folder) {
    throw new InstanceError('Set the launcher install folder in System settings first');
  }
  return folder;
};

// Pin a concrete loader version at create time. A picker-supplied version is
// trusted as-is (offline); otherwise the kit resolves the recommended/latest
// build (network). Vanilla has no loader version. Pinning keeps the catalog's
// loader inference (forge/fabric from a non-null version) unambiguous.
const pinLoaderVersion = async (
  kit: MinecraftKit,
  payload: CreateInstancePayload,
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

export const createInstance = async (
  kit: MinecraftKit,
  payload: CreateInstancePayload,
  deps: InstanceMutationDeps = {},
): Promise<LocalCatalogItem> => {
  const getSettings = deps.getSettings ?? defaultGetSettings;
  const newId = deps.newId ?? randomUUID;
  const now = deps.now ?? (() => new Date().toISOString());
  const saveManifest = deps.saveManifest ?? saveInstanceManifest;
  const upsertEntry = deps.upsertEntry ?? upsertInstanceEntry;

  const id = asInstanceId(newId());
  const dir = resolveInstanceDir(getSettings, id);
  const loaderVersion = await pinLoaderVersion(kit, payload);
  const timestamp = now();

  const manifest: InstanceManifest = InstanceManifestSchema.parse({
    schema: INSTANCE_MANIFEST_SCHEMA_VERSION,
    id,
    name: payload.name,
    minecraftVersion: payload.minecraftVersion,
    loader: { type: payload.loader, version: loaderVersion },
    runtimeVersion: payload.runtimeVersion ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await saveManifest(dir, manifest);
  upsertEntry({ id, name: manifest.name, dir, updatedAt: manifest.updatedAt });
  return manifestToCatalogItem(manifest, dir);
};

export const updateInstance = async (
  payload: UpdateInstancePayload,
  deps: InstanceMutationDeps = {},
): Promise<LocalCatalogItem> => {
  const now = deps.now ?? (() => new Date().toISOString());
  const loadManifest = deps.loadManifest ?? loadInstanceManifest;
  const saveManifest = deps.saveManifest ?? saveInstanceManifest;
  const upsertEntry = deps.upsertEntry ?? upsertInstanceEntry;
  const getEntry = deps.getEntry ?? getInstanceEntry;

  const entry = getEntry(payload.id);
  if (!entry) throw new InstanceError(`Local build "${payload.id}" not found`);
  const existing = await loadManifest(entry.dir);
  if (!existing) throw new InstanceError(`Local build "${payload.id}" has no readable manifest`);

  const next: InstanceManifest = {
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

export const deleteInstance = async (
  id: InstanceId,
  deps: InstanceMutationDeps = {},
): Promise<void> => {
  const getEntry = deps.getEntry ?? getInstanceEntry;
  const removeEntry = deps.removeEntry ?? removeInstanceEntry;
  const removeDir = deps.removeDir ?? removeInstanceDir;

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
