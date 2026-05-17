import { z } from 'zod';
import type { ClientId, ClientSlug } from './ids';
import { ServerSchema, StrapiEntitySchema, type StrapiMedia, StrapiMediaSchema } from './strapi';
import type { Server } from './strapi';

export const KeywordSchema = StrapiEntitySchema.extend({
  title: z.string(),
});

export type Keyword = z.infer<typeof KeywordSchema>;

// Strapi may return versions as a raw string or `{ version: string }`; service normalizes.
const VersionField = z
  .union([z.string(), z.null(), z.object({ version: z.string() }).passthrough()])
  .optional();

// Permissive: rich-text can be string, blocks structure, or null. Service coerces.
const DescriptionField = z.unknown().optional();

export const ClientResponseSchema = StrapiEntitySchema.extend({
  // Kept optional in the wire schema so unconfigured records don't blow up
  // parsing; the service layer drops records without a slug.
  slug: z.union([z.string(), z.null()]).optional(),
  title: z.string(),
  description: DescriptionField,
  shortDescription: DescriptionField,
  available: z.boolean(),

  minecraftVersion: VersionField,
  forgeVersion: VersionField,
  fabricVersion: VersionField,
  runtimeVersion: VersionField,

  servers: z.array(ServerSchema).optional(),

  screenshots: z.array(StrapiMediaSchema).default([]),
  background: StrapiMediaSchema,
  poster: StrapiMediaSchema,
  titleImage: StrapiMediaSchema.optional(),
  keywords: z.array(KeywordSchema).default([]),
});

export type ClientResponse = z.infer<typeof ClientResponseSchema>;

// Renderer-facing shape: versions normalized to strings, media URLs absolutized.
// `slug` is the launcher's canonical client id (settings key + folder name).
// Optional fields include `| undefined` for exactOptionalPropertyTypes
// compatibility with the Zod-inferred ClientResponse spread.
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

  servers?: Server[] | undefined;

  screenshots: StrapiMedia[];
  background: StrapiMedia;
  poster: StrapiMedia;
  titleImage?: StrapiMedia | undefined;
  keywords: Keyword[];
};
