import { z } from 'zod';
import type { ClientId, ClientSlug } from './ids';
import { ServerSchema, StrapiEntitySchema, type StrapiMedia, StrapiMediaSchema } from './strapi';
import type { Server } from './strapi';

export const KeywordSchema = StrapiEntitySchema.extend({
  title: z.string(),
});

export type Keyword = z.infer<typeof KeywordSchema>;

// Strapi sometimes returns versions as objects with a `version` field, sometimes as raw strings.
// The raw schema stays permissive; the service normalizes versions to strings before returning.
const VersionField = z
  .union([z.string(), z.null(), z.object({ version: z.string() }).passthrough()])
  .optional();

// Strapi may serialize descriptions as rich-text blocks (object/array) or as `null`
// for unset fields. Keep the raw shape permissive; the service coerces to string.
const DescriptionField = z.unknown().optional();

export const ClientResponseSchema = StrapiEntitySchema.extend({
  // `slug` is the launcher-side identifier — required in the schema but kept
  // optional/nullable here so the Zod parse doesn't reject records whose admin
  // hasn't filled it yet. The service layer raises a typed error if missing.
  slug: z.union([z.string(), z.null()]).optional(),
  title: z.string(),
  description: DescriptionField,
  shortDescription: DescriptionField,
  available: z.boolean(),

  minecraftVersion: VersionField,
  forgeVersion: VersionField,
  fabricVersion: VersionField,
  runtimeVersion: VersionField,

  bundleSlug: z.union([z.string(), z.null()]).optional(),
  servers: z.array(ServerSchema).optional(),

  screenshots: z.array(StrapiMediaSchema).default([]),
  background: StrapiMediaSchema,
  poster: StrapiMediaSchema,
  titleImage: StrapiMediaSchema.optional(),
  keywords: z.array(KeywordSchema).default([]),
});

export type ClientResponse = z.infer<typeof ClientResponseSchema>;

// Renderer-facing shape: versions normalized to strings, media URLs absolutized,
// `id` branded as `ClientId` and `slug` as `ClientSlug`.
// `slug` is the launcher's canonical client identifier — used as the settings key,
// IPC arg, and install folder name. `bundleSlug` is a separate, plain-string
// reference to a bundle in the bundle-registry plugin (kept here only because the
// API still returns it; not used for client identity).
// Optional fields include `| undefined` to satisfy exactOptionalPropertyTypes when
// spreading the Zod-inferred ClientResponse (Zod's `.optional()` widens to `T | undefined`).
export type Client = {
  id: ClientId;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | undefined;

  slug: ClientSlug;
  title: string;
  description: string;
  shortDescription: string;
  available: boolean;

  minecraftVersion: string;
  forgeVersion?: string | null | undefined;
  fabricVersion?: string | null | undefined;
  runtimeVersion?: string | null | undefined;

  bundleSlug?: string | null | undefined;
  servers?: Server[] | undefined;

  screenshots: StrapiMedia[];
  background: StrapiMedia;
  poster: StrapiMedia;
  titleImage?: StrapiMedia | undefined;
  keywords: Keyword[];
};
