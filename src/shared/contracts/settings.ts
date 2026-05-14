import { z } from 'zod';

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
});

export type ClientSettingsOverride = z.infer<typeof ClientSettingsOverrideSchema>;

export const LauncherSettingsSchema = z.object({
  memory: MemorySettingsSchema,
  storage: StorageSettingsSchema,
  launch: LaunchSettingsSchema,
  clients: z.record(z.string(), ClientSettingsOverrideSchema),
});

export type LauncherSettings = z.infer<typeof LauncherSettingsSchema>;

export type ResolvedClientSettings = {
  memory: MemorySettings;
  storage: { clientsFolder: string; clientFolder: string };
  launch: LaunchSettings;
  diff: {
    ram: boolean;
    folder: boolean;
    console: boolean;
    fullscreen: boolean;
  };
};

export const SetClientOverridePayloadSchema = z.object({
  bundleSlug: z.string().min(1),
  patch: ClientSettingsOverrideSchema,
});

export type SetClientOverridePayload = z.infer<typeof SetClientOverridePayloadSchema>;

export const PatchLauncherSettingsSchema = z
  .object({
    memory: MemorySettingsSchema.partial().optional(),
    storage: StorageSettingsSchema.partial().optional(),
    launch: LaunchSettingsSchema.partial().optional(),
  })
  .strict();

export type PatchLauncherSettings = z.infer<typeof PatchLauncherSettingsSchema>;
