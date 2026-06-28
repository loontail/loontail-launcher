import { z } from 'zod';
import type { BundleSlug, ClientId, ClientSlug } from './ids';
import { MediaSchema, ServerSchema } from './media';

export const KeywordSchema = z.object({
  id: z.string(),
  title: z.string(),
});

// Summary of the client's owned bundle, inlined by the backend (null/absent when the
// client has no linked bundle). Mirrors the service's BundleSummaryDto camelCase wire
// shape; `bundleSlug` above stays the canonical pointer.
export const BundleSummarySchema = z.object({
  slug: z.string(),
  version: z.union([z.string(), z.null()]).optional(),
  status: z.string(),
  filesCount: z.number(),
  manifestUrl: z.string(),
});

// The catalog wire shape. Relations are inlined; media URLs are backend-relative
// (the service layer absolutizes them). Versions and bundleSlug may be null.
export const ClientResponseSchema = z.object({
  id: z.string(),
  slug: z.union([z.string(), z.null()]).optional(),
  title: z.string(),
  description: z.union([z.string(), z.null()]).optional(),
  shortDescription: z.union([z.string(), z.null()]).optional(),
  available: z.boolean(),

  minecraftVersion: z.union([z.string(), z.null()]).optional(),
  forgeVersion: z.union([z.string(), z.null()]).optional(),
  fabricVersion: z.union([z.string(), z.null()]).optional(),
  runtimeVersion: z.union([z.string(), z.null()]).optional(),

  // Pointer to a bundle-registry build overlaid on the Minecraft install.
  // Empty/null → no bundle phase for this client.
  bundleSlug: z.union([z.string(), z.null()]).optional(),

  // Inlined summary of the owned bundle the backend now sends alongside bundleSlug.
  // Optional/nullable so older payloads (and clients with no bundle) still validate.
  bundle: BundleSummarySchema.nullable().optional(),

  servers: z.array(ServerSchema).default([]),

  screenshots: z.array(MediaSchema).default([]),
  // Media roles: `background` is the wide hero/banner art, `poster` is the small
  // square build icon (never a full-bleed cover), `titleImage` is the
  // transparent logo shown over the hero.
  background: MediaSchema.nullable().default(null),
  poster: MediaSchema.nullable().default(null),
  titleImage: MediaSchema.nullable().default(null),
  keywords: z.array(KeywordSchema).default([]),
});

export type ClientResponse = z.infer<typeof ClientResponseSchema>;

export const ClientListResponseSchema = z.object({
  clients: z.array(ClientResponseSchema),
});

// Renderer-facing view of ClientResponse: descriptions coerced to strings, media
// URLs absolutized, id/slug branded. Only transformed fields are respelled; the
// rest track ClientResponse via Omit so a wire-schema change can't drift.
export type Client = Omit<
  ClientResponse,
  | 'id'
  | 'slug'
  | 'description'
  | 'shortDescription'
  | 'minecraftVersion'
  | 'forgeVersion'
  | 'fabricVersion'
  | 'runtimeVersion'
  | 'bundleSlug'
> & {
  id: ClientId;
  slug: ClientSlug;
  description: string;
  shortDescription: string;
  minecraftVersion: string;
  forgeVersion?: string | null | undefined;
  fabricVersion?: string | null | undefined;
  runtimeVersion?: string | null | undefined;
  bundleSlug?: BundleSlug | null | undefined;
};
