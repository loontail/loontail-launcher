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
  NO_ACCOUNT: 'noAccount',
  NO_CLIENT_FOLDER: 'noClientFolder',
  LOADER_AMBIGUOUS: 'loaderAmbiguous',
  OP_IN_FLIGHT: 'opInFlight',
  NOT_INSTALLED: 'notInstalled',
  ABORTED: 'aborted',
  NETWORK_ERROR: 'networkError',
  INTEGRITY_ERROR: 'integrityError',
  DISK_ERROR: 'diskError',
  RUNTIME_ERROR: 'runtimeError',
  FORGE_ERROR: 'forgeError',
  LAUNCH_FAILED: 'launchFailed',
  KIT_ERROR: 'kitError',
  UNINSTALL_LOCKED: 'uninstallLocked',
  UNKNOWN: 'unknown',
} as const;

export type MinecraftErrorCode = (typeof MinecraftErrorCodes)[keyof typeof MinecraftErrorCodes];

export const MinecraftErrorCodeSchema = enumFromConst(MinecraftErrorCodes);

export const MinecraftStatusEventSchema = z.object({
  slug: CatalogKeySchema,
  status: InstallStatusSchema,
  paused: z.boolean().optional(),
  loader: LoaderChoiceSchema.optional(),
});

export type MinecraftStatusEvent = z.infer<typeof MinecraftStatusEventSchema>;

export const MinecraftProgressEventSchema = z.object({
  slug: CatalogKeySchema,
  stage: ProgressStageSchema,
  stagePercent: z.number().min(0).max(100),
  overallPercent: z.number().min(0).max(100),
  // Reconstructed bytes (stagePercent × stage total), so non-negative reals not ints.
  bytesDownloaded: z.number().nonnegative(),
  totalBytes: z.number().nonnegative(),
  speedBytesPerSec: z.number().nonnegative().optional(),
  currentFile: z.string().optional(),
});

export type MinecraftProgressEvent = z.infer<typeof MinecraftProgressEventSchema>;

export const MinecraftErrorEventSchema = z.object({
  slug: CatalogKeySchema,
  code: MinecraftErrorCodeSchema,
  message: z.string(),
});

export type MinecraftErrorEvent = z.infer<typeof MinecraftErrorEventSchema>;

export const InstallRequestSchema = z.object({
  slug: CatalogKeySchema,
  loader: LoaderChoiceSchema.optional(),
});

export type InstallRequest = z.infer<typeof InstallRequestSchema>;
