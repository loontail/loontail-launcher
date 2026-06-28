import type { LoaderKind } from '@loontail/minecraft-kit';
import { z } from 'zod';
import { CatalogKeySchema } from './ids';
import type { CatalogKey } from './ids';

export type { LoaderKind as LoaderChoice } from '@loontail/minecraft-kit';

// Mirrors kit's `Loaders` const. Kept local because kit pulls in Node-only
// modules (yauzl, crypto, fs/promises) that can't be bundled into the renderer.
export const LoaderChoices = {
  VANILLA: 'vanilla',
  FORGE: 'forge',
  FABRIC: 'fabric',
} as const satisfies Record<string, LoaderKind>;

export const LoaderChoiceSchema = z.enum([
  LoaderChoices.VANILLA,
  LoaderChoices.FORGE,
  LoaderChoices.FABRIC,
]);

export const MemorySettingsSchema = z.object({
  allocatedRamMb: z.number().int().nonnegative(),
});

export type MemorySettings = z.infer<typeof MemorySettingsSchema>;

export const StorageSettingsSchema = z.object({
  clientsFolder: z.string(),
});

export type StorageSettings = z.infer<typeof StorageSettingsSchema>;

export const LaunchSettingsSchema = z.object({
  console: z.boolean(),
  fullscreen: z.boolean(),
});

export type LaunchSettings = z.infer<typeof LaunchSettingsSchema>;

export const ClientRuntimeRefSchema = z.object({
  component: z.string(),
  path: z.string(),
});

export type ClientRuntimeRef = z.infer<typeof ClientRuntimeRefSchema>;

export const ClientSettingsOverrideSchema = z.object({
  memory: z.object({ allocatedRamMb: z.number().int().nonnegative().optional() }).optional(),
  storage: z.object({ clientFolder: z.string().optional() }).optional(),
  launch: z
    .object({ console: z.boolean().optional(), fullscreen: z.boolean().optional() })
    .optional(),
  runtime: ClientRuntimeRefSchema.optional(),
  loader: LoaderChoiceSchema.optional(),
});

export type ClientSettingsOverride = z.infer<typeof ClientSettingsOverrideSchema>;

export const LauncherSettingsSchema = z.object({
  memory: MemorySettingsSchema,
  storage: StorageSettingsSchema,
  launch: LaunchSettingsSchema,
  // Keyed by CatalogKey (`official:<slug>` / `local:<uuid>`) at runtime, but the
  // key schema stays a permissive string so a legacy store keyed by a bare slug
  // still validates on read and survives until the migration in
  // `normalizeLauncherSettings` rehydrates it.
  clients: z.record(z.string(), ClientSettingsOverrideSchema),
});

export type LauncherSettings = z.infer<typeof LauncherSettingsSchema>;

export type ResolvedClientSettings = {
  memory: MemorySettings;
  storage: { clientsFolder: string; clientFolder: string };
  launch: LaunchSettings;
  runtime: ClientRuntimeRef | null;
  loader: LoaderKind | null;
  diff: {
    ram: boolean;
    folder: boolean;
    console: boolean;
    fullscreen: boolean;
  };
};

export const SetClientOverridePayloadSchema = z.object({
  slug: CatalogKeySchema,
  patch: ClientSettingsOverrideSchema,
});

export type SetClientOverridePayload = {
  slug: CatalogKey;
  patch: ClientSettingsOverride;
};

export const PatchLauncherSettingsSchema = z
  .object({
    memory: MemorySettingsSchema.partial().optional(),
    storage: StorageSettingsSchema.partial().optional(),
    launch: LaunchSettingsSchema.partial().optional(),
  })
  .strict();

export type PatchLauncherSettings = z.infer<typeof PatchLauncherSettingsSchema>;
