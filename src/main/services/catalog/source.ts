import {
  type CatalogItem,
  type CatalogRef,
  type MediaRef,
  type OfficialCatalogItem,
  SourceKinds,
  officialKey,
} from '@shared/contracts/catalog';
import type { Client } from '@shared/contracts/client';

// One build source feeding the unified catalog. `listItems` is the catalog
// listing; `getItem` resolves a single build for install/launch/repair. A
// source returns null from `getItem` for refs it does not own or that are
// absent; it throws only on a genuine fetch failure (so the aggregator can mark
// it degraded without blanking other sources).
export type CatalogSource = {
  readonly id: CatalogRef['source'];
  listItems(opts?: { locale?: string }): Promise<CatalogItem[]>;
  getItem(ref: CatalogRef): Promise<CatalogItem | null>;
};

const mediaRef = (media: { url: string } | null | undefined): MediaRef | null =>
  media ? { url: media.url } : null;

// Project a normalized API Client into the source-agnostic catalog shape the
// UI and the kit bridge consume. Keeps the raw Client for legacy read paths.
export const clientToCatalogItem = (client: Client): OfficialCatalogItem => ({
  kind: SourceKinds.OFFICIAL,
  key: officialKey(client.slug),
  ref: { source: SourceKinds.OFFICIAL, slug: client.slug },
  spec: {
    minecraftVersion: client.minecraftVersion,
    forgeVersion: client.forgeVersion ?? null,
    fabricVersion: client.fabricVersion ?? null,
    runtimeVersion: client.runtimeVersion ?? null,
    bundleSlug: client.bundleSlug ?? null,
  },
  presentation: {
    title: client.title,
    shortDescription: client.shortDescription,
    description: client.description,
    available: client.available,
    media: {
      poster: mediaRef(client.poster),
      background: mediaRef(client.background),
      titleImage: mediaRef(client.titleImage),
      screenshots: (client.screenshots ?? []).map((media): MediaRef => ({ url: media.url })),
    },
    servers: client.servers ?? [],
    // The native contract drops record timestamps; official ordering falls back
    // to the source-provided sequence (stable sort) via the empty sentinel.
    createdAt: '',
    updatedAt: '',
  },
  raw: client,
});
