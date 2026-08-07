import { z } from 'zod';
import { BundleSlugSchema, ClientSlugSchema, LocalBuildIdSchema } from './ids';
import { ServerSchema } from './media';
import { LoaderChoiceSchema } from './settings';

// Bump when the on-disk `instance.json` shape changes incompatibly; older
// manifests are migrated forward on read.
export const INSTANCE_MANIFEST_SCHEMA_VERSION = 1;

// A local build's overlay source. `none` keeps mods as loose files under
// `mods/`; `remote` opts into a managed bundle-registry overlay (the same sync
// path official builds use).
export const LocalBuildBundleRefSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('none') }),
  z.object({
    source: z.literal('remote'),
    bundleSlug: BundleSlugSchema,
    manifestUrl: z.string().url(),
  }),
]);

export const LocalBuildPresentationSchema = z.object({
  description: z.string().default(''),
  // Relative path (under the build dir) to a user-supplied icon. Null → placeholder.
  icon: z.string().nullable().default(null),
  // Built-in lucide icon key chosen at create time. Null → generated placeholder.
  iconPreset: z.string().nullable().default(null),
  screenshots: z.array(z.string()).default([]),
});

export const LocalBuildLoaderSchema = z.object({
  type: LoaderChoiceSchema,
  // Loader build pinned at create time. Null for vanilla and for "latest"
  // loaders the kit resolves at install.
  version: z.string().min(1).nullable(),
});

// Optional pointer to the official build this local build was cloned from; null
// for builds authored from scratch.
export const LocalBuildOriginSchema = z.object({
  source: z.literal('official'),
  slug: ClientSlugSchema,
});

export const LocalBuildManifestSchema = z.object({
  schema: z.literal(INSTANCE_MANIFEST_SCHEMA_VERSION),
  id: LocalBuildIdSchema,
  name: z.string().min(1),
  minecraftVersion: z.string().min(1),
  loader: LocalBuildLoaderSchema,
  runtimeVersion: z.string().min(1).nullable().default(null),
  bundle: LocalBuildBundleRefSchema.default({ source: 'none' }),
  presentation: LocalBuildPresentationSchema.default({
    description: '',
    icon: null,
    iconPreset: null,
    screenshots: [],
  }),
  servers: z.array(ServerSchema).default([]),
  origin: LocalBuildOriginSchema.nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type LocalBuildManifest = z.infer<typeof LocalBuildManifestSchema>;

// Persisted index for fast catalog listing without walking every build
// folder. Each `instance.json` is authoritative; this index is rebuildable from
// them when missing or corrupt.
export const LocalBuildRegistryEntrySchema = z.object({
  id: LocalBuildIdSchema,
  name: z.string().min(1),
  dir: z.string().min(1),
  updatedAt: z.string().datetime(),
});

export type LocalBuildRegistryEntry = z.infer<typeof LocalBuildRegistryEntrySchema>;

export const INSTANCE_REGISTRY_SCHEMA_VERSION = 1;

export const LocalBuildRegistrySchema = z.object({
  schema: z.literal(INSTANCE_REGISTRY_SCHEMA_VERSION),
  // The persisted field name predates the local-build rename; keep it so an
  // existing registry still parses.
  instances: z.array(LocalBuildRegistryEntrySchema).default([]),
});

export type LocalBuildRegistry = z.infer<typeof LocalBuildRegistrySchema>;

// Validated at the `builds.create` IPC boundary; pinned metadata is derived in
// the main process via the kit version APIs.
export const CreateBuildPayloadSchema = z.object({
  name: z.string().min(1),
  minecraftVersion: z.string().min(1),
  loader: LoaderChoiceSchema,
  loaderVersion: z.string().min(1).optional(),
  runtimeVersion: z.string().min(1).optional(),
  iconPreset: z.string().min(1).optional(),
});

export type CreateBuildPayload = z.infer<typeof CreateBuildPayloadSchema>;

// Validated at `builds.update`; only user-editable fields. Identity and
// timestamps are owned by the repo.
export const UpdateBuildPayloadSchema = z.object({
  id: LocalBuildIdSchema,
  patch: z
    .object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
    })
    .strict(),
});

export type UpdateBuildPayload = z.infer<typeof UpdateBuildPayloadSchema>;

// Renderer-facing option shapes for the version pickers, projected in the main
// process so the kit's Node-only types never reach the renderer.
export type MinecraftVersionOption = {
  readonly id: string;
  readonly type: string;
};

export type LoaderVersionOption = {
  readonly version: string;
  readonly recommended?: boolean;
  readonly stable?: boolean;
};

export const ListLoaderVersionsArgsSchema = z.object({
  loader: LoaderChoiceSchema,
  minecraftVersion: z.string().min(1),
});

export type ListLoaderVersionsArgs = z.infer<typeof ListLoaderVersionsArgsSchema>;
