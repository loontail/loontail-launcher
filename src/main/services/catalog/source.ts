import {
  type CatalogItem,
  type CatalogRef,
  type MediaRef,
  type OfficialCatalogItem,
  officialKey,
  SourceKinds,
} from '@shared/contracts/catalog';
import type { Client } from '@shared/contracts/client';

// One build source feeding the unified catalog. `getItem` returns null for refs
// it does not own or that are absent; it throws only on a genuine fetch failure
// (so the aggregator can mark it degraded without blanking other sources).
export type CatalogSourceOptions = { locale?: string };

export type CatalogSource = {
  readonly id: CatalogRef['source'];
  listItems(opts?: CatalogSourceOptions): Promise<CatalogItem[]>;
  getItem(ref: CatalogRef, opts?: CatalogSourceOptions): Promise<CatalogItem | null>;
};

const mediaRef = (media: { url: string } | null | undefined): MediaRef | null =>
  media ? { url: media.url } : null;

// Project a normalized API Client into the source-agnostic catalog shape the
// UI and the kit bridge consume.
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
    // Empty sentinel: with no record timestamps, official ordering falls back to
    // the source-provided sequence via the stable sort.
    createdAt: '',
    updatedAt: '',
  },
  raw: client,
});
