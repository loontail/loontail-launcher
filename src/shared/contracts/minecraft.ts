import type { ProgressStage } from '@loontail/minecraft-kit';
import { z } from 'zod';
import { enumFromConst } from './enum';
import { CatalogKeySchema } from './ids';
import { LoaderChoiceSchema } from './settings';

export type { ProgressStage } from '@loontail/minecraft-kit';

export const InstallStatuses = {
  UNKNOWN: 'unknown',
  UNVERIFIED: 'unverified',
  NOT_INSTALLED: 'not-installed',
  INSTALLING: 'installing',
  INSTALLED: 'installed',
  LAUNCHING: 'launching',
  RUNNING: 'running',
  REPAIRING: 'repairing',
  UNINSTALLING: 'uninstalling',
  ERROR: 'error',
} as const;

export type InstallStatus = (typeof InstallStatuses)[keyof typeof InstallStatuses];

export const InstallStatusSchema = enumFromConst(InstallStatuses);

export const ProgressStages = {
  PREPARE: 'prepare',
  RUNTIME: 'runtime',
  MINECRAFT: 'minecraft',
  LOADER: 'loader',
  FINALIZE: 'finalize',
} as const satisfies Record<string, ProgressStage>;

export const ProgressStageSchema = enumFromConst(ProgressStages);

export const MinecraftErrorCodes = {
  NO_ACCOUNT: 'minecraft/noAccount',
  NO_CLIENT_FOLDER: 'minecraft/noClientFolder',
  LOADER_AMBIGUOUS: 'minecraft/loaderAmbiguous',
  OP_IN_FLIGHT: 'minecraft/opInFlight',
  NOT_INSTALLED: 'minecraft/notInstalled',
  ABORTED: 'minecraft/aborted',
  NETWORK_ERROR: 'minecraft/networkError',
  INTEGRITY_ERROR: 'minecraft/integrityError',
  DISK_ERROR: 'minecraft/diskError',
  RUNTIME_ERROR: 'minecraft/runtimeError',
  FORGE_ERROR: 'minecraft/forgeError',
  LAUNCH_FAILED: 'minecraft/launchFailed',
  KIT_ERROR: 'minecraft/kitError',
  UNINSTALL_LOCKED: 'minecraft/uninstallLocked',
  UNKNOWN: 'minecraft/unknown',
} as const;

export type MinecraftErrorCode = (typeof MinecraftErrorCodes)[keyof typeof MinecraftErrorCodes];

export const MinecraftErrorCodeSchema = enumFromConst(MinecraftErrorCodes);

export const MinecraftStatusEventSchema = z.object({
  key: CatalogKeySchema,
  status: InstallStatusSchema,
  paused: z.boolean().optional(),
  loader: LoaderChoiceSchema.optional(),
});

export type MinecraftStatusEvent = z.infer<typeof MinecraftStatusEventSchema>;

export const MinecraftProgressEventSchema = z.object({
  key: CatalogKeySchema,
  stage: ProgressStageSchema,
  stagePercent: z.number().min(0).max(100),
  overallPercent: z.number().min(0).max(100),
  // Reconstructed bytes (stagePercent × stage total), so non-negative reals not ints.
  bytesDownloaded: z.number().nonnegative(),
  totalBytes: z.number().nonnegative(),
  currentFile: z.string().optional(),
});

export type MinecraftProgressEvent = z.infer<typeof MinecraftProgressEventSchema>;

export const MinecraftErrorEventSchema = z.object({
  key: CatalogKeySchema,
  code: MinecraftErrorCodeSchema,
  message: z.string(),
});

export type MinecraftErrorEvent = z.infer<typeof MinecraftErrorEventSchema>;

export const InstallRequestSchema = z.object({
  key: CatalogKeySchema,
  loader: LoaderChoiceSchema.optional(),
});

export type InstallRequest = z.infer<typeof InstallRequestSchema>;
