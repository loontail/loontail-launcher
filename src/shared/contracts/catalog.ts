import type { Client } from './client';
import type { BundleSlug, CatalogKey, ClientSlug, LocalBuildId } from './ids';
import type { LocalBuildManifest } from './localBuild';
import type { Server } from './media';

// The build sources feeding the unified catalog. Local is the primary,
// network-free source of truth; official is the curated backend API source.
export const SourceKinds = {
  OFFICIAL: 'official',
  LOCAL: 'local',
} as const;

export type SourceKind = (typeof SourceKinds)[keyof typeof SourceKinds];

// Source-discriminated handle to one build. Local refs never touch the network;
// install/launch/repair resolve a build from its ref via the catalog service.
export type CatalogRef =
  | { readonly source: typeof SourceKinds.OFFICIAL; readonly slug: ClientSlug }
  | { readonly source: typeof SourceKinds.LOCAL; readonly id: LocalBuildId };

export const officialKey = (slug: ClientSlug): CatalogKey => `official:${slug}` as CatalogKey;
export const localKey = (id: LocalBuildId): CatalogKey => `local:${id}` as CatalogKey;

export const refValue = (ref: CatalogRef): string =>
  ref.source === SourceKinds.OFFICIAL ? ref.slug : ref.id;

// Returns null for a malformed key so callers fail closed rather than mis-route.
export const parseCatalogKey = (key: CatalogKey): CatalogRef | null => {
  const raw = key as string;
  const idx = raw.indexOf(':');
  if (idx <= 0) return null;
  const source = raw.slice(0, idx);
  const value = raw.slice(idx + 1);
  if (!value) return null;
  if (source === SourceKinds.OFFICIAL) {
    return { source: SourceKinds.OFFICIAL, slug: value as ClientSlug };
  }
  if (source === SourceKinds.LOCAL) {
    return { source: SourceKinds.LOCAL, id: value as LocalBuildId };
  }
  return null;
};

// The bare ref value (slug or UUID) carried by a CatalogKey. Used for disk
// folder names, since `:` is an illegal Windows filename char. Null when malformed.
export const catalogKeyToRefValue = (key: CatalogKey): string | null => {
  const ref = parseCatalogKey(key);
  if (!ref) return null;
  return refValue(ref);
};

// The build inputs the kit bridge (`buildSpecToTargetInput`) consumes,
// sourced uniformly from either build kind.
export type BuildSpec = {
  readonly minecraftVersion: string;
  readonly forgeVersion?: string | null;
  readonly fabricVersion?: string | null;
  readonly runtimeVersion?: string | null;
  readonly bundleSlug?: BundleSlug | null;
};

export type MediaRef = { readonly url: string };

// Projected from each source so the renderer never branches on official vs local.
export type CatalogPresentation = {
  readonly title: string;
  readonly shortDescription: string;
  readonly description: string;
  readonly available: boolean;
  // Lucide icon key for a local build only; official builds never set this.
  readonly iconPreset?: string | null;
  readonly media: {
    readonly poster: MediaRef | null;
    readonly background: MediaRef | null;
    readonly titleImage: MediaRef | null;
    readonly screenshots: readonly MediaRef[];
  };
  readonly servers: readonly Server[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type OfficialCatalogItem = {
  readonly kind: typeof SourceKinds.OFFICIAL;
  // The cross-kind operational id (`official:<slug>` or `local:<uuid>`) that keys
  // every downstream channel, store, and settings record, so the renderer never
  // down-casts to a bare slug/uuid.
  readonly key: CatalogKey;
  readonly ref: { readonly source: typeof SourceKinds.OFFICIAL; readonly slug: ClientSlug };
  readonly spec: BuildSpec;
  readonly presentation: CatalogPresentation;
  readonly raw: Client;
};

export type LocalCatalogItem = {
  readonly kind: typeof SourceKinds.LOCAL;
  /** The operational CatalogKey — see {@link OfficialCatalogItem.key}. */
  readonly key: CatalogKey;
  readonly ref: { readonly source: typeof SourceKinds.LOCAL; readonly id: LocalBuildId };
  readonly spec: BuildSpec;
  readonly presentation: CatalogPresentation;
  readonly manifest: LocalBuildManifest;
};

export type CatalogItem = OfficialCatalogItem | LocalCatalogItem;

export const isOfficial = (item: CatalogItem): item is OfficialCatalogItem =>
  item.kind === SourceKinds.OFFICIAL;

export type SourceStatus = { readonly id: SourceKind; readonly ok: boolean };

// The catalog.list IPC result: merged items plus a per-source health flag so the
// UI can show a degraded-source banner without blanking local builds.
export type CatalogListResult = {
  readonly items: readonly CatalogItem[];
  readonly sources: readonly SourceStatus[];
};
