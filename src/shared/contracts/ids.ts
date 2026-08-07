import { z } from 'zod';

type Brand<T, B extends string> = T & { readonly __brand: B };

export type ClientSlug = Brand<string, 'ClientSlug'>;
export type ClientId = Brand<string, 'ClientId'>;
export type BundleSlug = Brand<string, 'BundleSlug'>;
// A UUID that doubles as the local build's on-disk folder name under
// `<clientsFolder>/local/`.
export type LocalBuildId = Brand<string, 'LocalBuildId'>;
// Source-namespaced build id keying settings, op locks, and status routing:
// `official:<ClientSlug>` or `local:<LocalBuildId>`. Composed via `./catalog`.
export type CatalogKey = Brand<string, 'CatalogKey'>;

export const asClientSlug = (value: string): ClientSlug => value as ClientSlug;
export const asClientId = (value: string): ClientId => value as ClientId;
export const asBundleSlug = (value: string): BundleSlug => value as BundleSlug;
export const asLocalBuildId = (value: string): LocalBuildId => value as LocalBuildId;
export const asCatalogKey = (value: string): CatalogKey => value as CatalogKey;

export const ClientSlugSchema = z
  .string()
  .min(1)
  .transform((value): ClientSlug => value as ClientSlug);

export const BundleSlugSchema = z
  .string()
  .min(1)
  .transform((value): BundleSlug => value as BundleSlug);

export const LocalBuildIdSchema = z
  .string()
  .guid()
  .transform((value): LocalBuildId => value as LocalBuildId);

// Validating the source-namespaced shape lets the IPC surface reject a bare
// slug/uuid and keeps the two keyspaces distinct. The prefix check is the cheap
// fail-closed guard for the route layer; `parseCatalogKey` recovers the bare ref.
export const CatalogKeySchema = z
  .string()
  .min(1)
  .refine((value) => /^(official:|local:).+/.test(value), {
    message: 'must be a source-namespaced catalog key (official:… or local:…)',
  })
  .transform((value): CatalogKey => value as CatalogKey);
