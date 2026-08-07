import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CatalogSource } from '@main/services/catalog/source';
import {
  type CatalogItem,
  type CatalogRef,
  type LocalCatalogItem,
  localKey,
  SourceKinds,
} from '@shared/contracts/catalog';
import type { LocalBuildManifest, LocalBuildRegistryEntry } from '@shared/contracts/localBuild';
import { LoaderChoices } from '@shared/contracts/settings';
import { loadLocalBuildManifest } from './localBuildRepo';
import { getLocalBuildEntry, listLocalBuildEntries } from './registry';

const mediaUrl = (dir: string, relative: string): string =>
  pathToFileURL(path.join(dir, relative)).href;

// Project a local build manifest into the source-agnostic catalog shape.
// Loader version is pinned at create time, so the forge/fabric spec fields are
// populated only for the matching loader (keeps resolveLoader unambiguous).
export const manifestToCatalogItem = (
  manifest: LocalBuildManifest,
  dir: string,
): LocalCatalogItem => ({
  kind: SourceKinds.LOCAL,
  key: localKey(manifest.id),
  ref: { source: SourceKinds.LOCAL, id: manifest.id },
  spec: {
    minecraftVersion: manifest.minecraftVersion,
    forgeVersion: manifest.loader.type === LoaderChoices.FORGE ? manifest.loader.version : null,
    fabricVersion: manifest.loader.type === LoaderChoices.FABRIC ? manifest.loader.version : null,
    runtimeVersion: manifest.runtimeVersion,
    bundleSlug: manifest.bundle.source === 'remote' ? manifest.bundle.bundleSlug : null,
  },
  presentation: {
    title: manifest.name,
    shortDescription: '',
    description: manifest.presentation.description,
    available: true,
    iconPreset: manifest.presentation.iconPreset,
    media: {
      poster: manifest.presentation.icon
        ? { url: mediaUrl(dir, manifest.presentation.icon) }
        : null,
      background: null,
      titleImage: null,
      screenshots: manifest.presentation.screenshots.map((relative) => ({
        url: mediaUrl(dir, relative),
      })),
    },
    servers: manifest.servers,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
  },
  manifest,
});

export type LocalCatalogSourceDeps = {
  listEntries: () => LocalBuildRegistryEntry[];
  getEntry: (ref: CatalogRef) => LocalBuildRegistryEntry | undefined;
  loadManifest: (dir: string) => Promise<LocalBuildManifest | null>;
};

const defaultDeps: LocalCatalogSourceDeps = {
  listEntries: listLocalBuildEntries,
  getEntry: (ref) => (ref.source === SourceKinds.LOCAL ? getLocalBuildEntry(ref.id) : undefined),
  loadManifest: loadLocalBuildManifest,
};

// The local, network-free build source — the primary source of the unified
// catalog. Always resolves from disk so local builds list and launch with the
// backend unreachable.
export const createLocalCatalogSource = (
  deps: LocalCatalogSourceDeps = defaultDeps,
): CatalogSource => ({
  id: SourceKinds.LOCAL,
  listItems: async (): Promise<CatalogItem[]> => {
    const items: CatalogItem[] = [];
    for (const entry of deps.listEntries()) {
      const manifest = await deps.loadManifest(entry.dir);
      // Unreadable/corrupt manifests are skipped (logged in the repo); the
      // registry entry survives so a future repair/delete flow can act on it.
      if (manifest) items.push(manifestToCatalogItem(manifest, entry.dir));
    }
    return items;
  },
  getItem: async (ref: CatalogRef): Promise<CatalogItem | null> => {
    if (ref.source !== SourceKinds.LOCAL) return null;
    const entry = deps.getEntry(ref);
    if (!entry) return null;
    const manifest = await deps.loadManifest(entry.dir);
    return manifest ? manifestToCatalogItem(manifest, entry.dir) : null;
  },
});
