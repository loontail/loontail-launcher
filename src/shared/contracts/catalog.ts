import type { Client } from './client';
import type { BundleSlug, CatalogKey, ClientSlug, InstanceId } from './ids';
import type { InstanceManifest } from './instance';
import type { Server } from './strapi';

// The build sources feeding the unified catalog. Local is the primary,
// network-free source of truth; official is the curated Strapi/CMS source.
export const SourceKinds = {
  OFFICIAL: 'official',
  LOCAL: 'local',
} as const;

export type SourceKind = (typeof SourceKinds)[keyof typeof SourceKinds];

// Source-discriminated handle to one build. Local refs never touch the network;
// install/launch/repair resolve a build from its ref via the catalog service.
export type CatalogRef =
  | { readonly source: typeof SourceKinds.OFFICIAL; readonly slug: ClientSlug }
  | { readonly source: typeof SourceKinds.LOCAL; readonly id: InstanceId };

export const officialKey = (slug: ClientSlug): CatalogKey => `official:${slug}` as CatalogKey;
export const localKey = (id: InstanceId): CatalogKey => `local:${id}` as CatalogKey;

export const catalogKeyFor = (ref: CatalogRef): CatalogKey =>
  ref.source === SourceKinds.OFFICIAL ? officialKey(ref.slug) : localKey(ref.id);

// Recover a ref from a stored key (settings/event routing). Returns null for a
// malformed key so callers fail closed rather than mis-route an operation.
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
    return { source: SourceKinds.LOCAL, id: value as InstanceId };
  }
  return null;
};

// The exact build inputs the kit bridge (`buildSpecToTargetInput`) consumes,
// sourced uniformly from either build kind.
export type BuildSpec = {
  readonly minecraftVersion: string;
  readonly forgeVersion?: string | null;
  readonly fabricVersion?: string | null;
  readonly runtimeVersion?: string | null;
  readonly bundleSlug?: BundleSlug | null;
};

// A resolved, render-ready media URL (http, or a cache://-style protocol URL,
// or file:// for local instance media).
export type MediaRef = { readonly url: string };

// Presentation surface the UI binds to, projected from each source so the
// renderer never branches on Strapi vs local shapes.
export type CatalogPresentation = {
  readonly title: string;
  readonly shortDescription: string;
  readonly description: string;
  readonly available: boolean;
  // A built-in lucide icon key chosen for a local build (null/absent → poster or
  // generated initial). Official builds never set this.
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
  readonly key: CatalogKey;
  readonly ref: { readonly source: typeof SourceKinds.OFFICIAL; readonly slug: ClientSlug };
  readonly spec: BuildSpec;
  readonly presentation: CatalogPresentation;
  // The normalized Strapi client, retained for legacy paths during migration.
  readonly raw: Client;
};

export type LocalCatalogItem = {
  readonly kind: typeof SourceKinds.LOCAL;
  readonly key: CatalogKey;
  readonly ref: { readonly source: typeof SourceKinds.LOCAL; readonly id: InstanceId };
  readonly spec: BuildSpec;
  readonly presentation: CatalogPresentation;
  readonly manifest: InstanceManifest;
};

export type CatalogItem = OfficialCatalogItem | LocalCatalogItem;

export const isOfficial = (item: CatalogItem): item is OfficialCatalogItem =>
  item.kind === SourceKinds.OFFICIAL;
export const isLocal = (item: CatalogItem): item is LocalCatalogItem =>
  item.kind === SourceKinds.LOCAL;

export type SourceStatus = { readonly id: SourceKind; readonly ok: boolean };

// The catalog.list IPC result: merged items plus a per-source health flag so the
// UI can show a degraded-CMS banner without blanking local builds.
export type CatalogListResult = {
  readonly items: readonly CatalogItem[];
  readonly sources: readonly SourceStatus[];
};
