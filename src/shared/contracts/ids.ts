import { z } from 'zod';

type Brand<T, B extends string> = T & { readonly __brand: B };

export type ClientSlug = Brand<string, 'ClientSlug'>;
export type ClientId = Brand<string, 'ClientId'>;
export type UserId = Brand<number, 'UserId'>;
export type BundleSlug = Brand<string, 'BundleSlug'>;
// Identity of a user-authored local build. A UUID that doubles as its on-disk
// folder name under `<clientsFolder>/local/`.
export type InstanceId = Brand<string, 'InstanceId'>;
// Source-namespaced identity for a catalog build, used to key settings, op
// locks, and status routing across both build kinds: `official:<ClientSlug>`
// or `local:<InstanceId>`. Composed via the helpers in `./catalog`.
export type CatalogKey = Brand<string, 'CatalogKey'>;

export const asClientSlug = (value: string): ClientSlug => value as ClientSlug;
export const asClientId = (value: string): ClientId => value as ClientId;
export const asUserId = (value: number): UserId => value as UserId;
export const asBundleSlug = (value: string): BundleSlug => value as BundleSlug;
export const asInstanceId = (value: string): InstanceId => value as InstanceId;
export const asCatalogKey = (value: string): CatalogKey => value as CatalogKey;

export const ClientSlugSchema = z
  .string()
  .min(1)
  .transform((value): ClientSlug => value as ClientSlug);

export const ClientIdSchema = z
  .string()
  .min(1)
  .transform((value): ClientId => value as ClientId);

export const UserIdSchema = z
  .number()
  .int()
  .transform((value): UserId => value as UserId);

export const BundleSlugSchema = z
  .string()
  .min(1)
  .transform((value): BundleSlug => value as BundleSlug);

export const InstanceIdSchema = z
  .string()
  .uuid()
  .transform((value): InstanceId => value as InstanceId);

// The cross-kind operational id carried over IPC: `official:<slug>` or
// `local:<uuid>`. Validating the source-namespaced shape lets the IPC surface
// reject a bare slug/uuid (the ClientSlug brand-erosion the punned channels
// suffered) and keeps the two keyspaces distinct. `parseCatalogKey` (in
// `./catalog`) recovers the source + bare ref; the prefix check here is the
// cheap fail-closed guard the route layer needs.
export const CatalogKeySchema = z
  .string()
  .min(1)
  .refine((value) => /^(official:|local:).+/.test(value), {
    message: 'must be a source-namespaced catalog key (official:… or local:…)',
  })
  .transform((value): CatalogKey => value as CatalogKey);
