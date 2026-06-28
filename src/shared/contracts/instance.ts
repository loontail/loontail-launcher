import { z } from 'zod';
import { BundleSlugSchema, ClientSlugSchema, InstanceIdSchema } from './ids';
import { ServerSchema } from './media';
import { LoaderChoiceSchema } from './settings';

// Bump when the on-disk `instance.json` shape changes incompatibly; older
// manifests are migrated forward on read.
export const INSTANCE_MANIFEST_SCHEMA_VERSION = 1;

// A local build's overlay source. `none` keeps mods as loose files under
// `mods/`; `remote` opts into a managed bundle-registry overlay (the same sync
// path official builds use).
export const InstanceBundleRefSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('none') }),
  z.object({
    source: z.literal('remote'),
    bundleSlug: BundleSlugSchema,
    manifestUrl: z.string().url(),
  }),
]);

export const InstancePresentationSchema = z.object({
  description: z.string().default(''),
  // Relative path (under the instance dir) to a user-supplied icon. Null → placeholder.
  icon: z.string().nullable().default(null),
  // Built-in lucide icon key chosen at create time. Null → generated placeholder.
  iconPreset: z.string().nullable().default(null),
  screenshots: z.array(z.string()).default([]),
});

export const InstanceLoaderSchema = z.object({
  type: LoaderChoiceSchema,
  // Loader build pinned at create time. Null for vanilla and for "latest"
  // loaders the kit resolves at install.
  version: z.string().min(1).nullable(),
});

// Optional pointer to the official build this instance was cloned from; null
// for builds authored from scratch.
export const InstanceOriginSchema = z.object({
  source: z.literal('official'),
  slug: ClientSlugSchema,
});

export const InstanceManifestSchema = z.object({
  schema: z.literal(INSTANCE_MANIFEST_SCHEMA_VERSION),
  id: InstanceIdSchema,
  name: z.string().min(1),
  minecraftVersion: z.string().min(1),
  loader: InstanceLoaderSchema,
  runtimeVersion: z.string().min(1).nullable().default(null),
  bundle: InstanceBundleRefSchema.default({ source: 'none' }),
  presentation: InstancePresentationSchema.default({
    description: '',
    icon: null,
    iconPreset: null,
    screenshots: [],
  }),
  servers: z.array(ServerSchema).default([]),
  origin: InstanceOriginSchema.nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type InstanceManifest = z.infer<typeof InstanceManifestSchema>;

// Persisted index for fast catalog listing without walking every instance
// folder. Each `instance.json` is authoritative; this index is rebuildable from
// them when missing or corrupt.
export const InstanceRegistryEntrySchema = z.object({
  id: InstanceIdSchema,
  name: z.string().min(1),
  dir: z.string().min(1),
  updatedAt: z.string().datetime(),
});

export type InstanceRegistryEntry = z.infer<typeof InstanceRegistryEntrySchema>;

export const INSTANCE_REGISTRY_SCHEMA_VERSION = 1;

export const InstanceRegistrySchema = z.object({
  schema: z.literal(INSTANCE_REGISTRY_SCHEMA_VERSION),
  instances: z.array(InstanceRegistryEntrySchema).default([]),
});

export type InstanceRegistry = z.infer<typeof InstanceRegistrySchema>;

// Validated at the `builds.create` IPC boundary; pinned metadata is derived in
// the main process via the kit version APIs.
export const CreateInstancePayloadSchema = z.object({
  name: z.string().min(1),
  minecraftVersion: z.string().min(1),
  loader: LoaderChoiceSchema,
  loaderVersion: z.string().min(1).optional(),
  runtimeVersion: z.string().min(1).optional(),
  iconPreset: z.string().min(1).optional(),
});

export type CreateInstancePayload = z.infer<typeof CreateInstancePayloadSchema>;

// Validated at `builds.update`; only user-editable fields. Identity and
// timestamps are owned by the repo.
export const UpdateInstancePayloadSchema = z.object({
  id: InstanceIdSchema,
  patch: z
    .object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
    })
    .strict(),
});

export type UpdateInstancePayload = z.infer<typeof UpdateInstancePayloadSchema>;

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
