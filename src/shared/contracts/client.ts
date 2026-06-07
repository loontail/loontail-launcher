import { z } from 'zod';
import type { BundleSlug, ClientId, ClientSlug } from './ids';
import { ServerSchema, StrapiEntitySchema, StrapiMediaSchema } from './strapi';

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

  // Optional pointer to a bundle-registry build whose files are overlaid on top
  // of the Minecraft install (mods, configs, patched libs). Empty/null → no
  // bundle phase for this client.
  bundleSlug: z.union([z.string(), z.null()]).optional(),

  servers: z.array(ServerSchema).optional(),

  screenshots: z.array(StrapiMediaSchema).default([]),
  // Media roles in the launcher UI: `background` is the wide banner / hero art
  // (tile banner + detail-modal backdrop), `poster` is the small square build
  // ICON (tile/footer icon — never a full-bleed cover), `titleImage` is the
  // transparent logo shown over the hero.
  background: StrapiMediaSchema,
  poster: StrapiMediaSchema,
  titleImage: StrapiMediaSchema.optional(),
  keywords: z.array(KeywordSchema).default([]),
});

export type ClientResponse = z.infer<typeof ClientResponseSchema>;

// Renderer-facing view of ClientResponse: versions normalized to strings, media
// URLs absolutized, id/slug branded. Only the transformed fields are spelled out;
// every other field tracks ClientResponse so a wire-schema change can't drift.
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
