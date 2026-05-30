import type { ProgressStage } from '@loontail/minecraft-kit';
import { z } from 'zod';
import { ConsoleSources } from './console';
import { enumFromConst } from './enum';
import { ClientSlugSchema } from './ids';
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
  RUNTIME_ERROR: 'runtimeError',
  LAUNCH_FAILED: 'launchFailed',
  KIT_ERROR: 'kitError',
  UNINSTALL_LOCKED: 'uninstallLocked',
  UNKNOWN: 'unknown',
} as const;

export type MinecraftErrorCode = (typeof MinecraftErrorCodes)[keyof typeof MinecraftErrorCodes];

export const MinecraftErrorCodeSchema = enumFromConst(MinecraftErrorCodes);

export const MinecraftStatusEventSchema = z.object({
  slug: ClientSlugSchema,
  status: InstallStatusSchema,
  paused: z.boolean().optional(),
  loader: LoaderChoiceSchema.optional(),
});

export type MinecraftStatusEvent = z.infer<typeof MinecraftStatusEventSchema>;

export const MinecraftProgressEventSchema = z.object({
  slug: ClientSlugSchema,
  stage: ProgressStageSchema,
  stagePercent: z.number().min(0).max(100),
  overallPercent: z.number().min(0).max(100),
  bytesDownloaded: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  currentFile: z.string().optional(),
});

export type MinecraftProgressEvent = z.infer<typeof MinecraftProgressEventSchema>;

export const MinecraftLogEventSchema = z.object({
  slug: ClientSlugSchema,
  stream: z.enum([ConsoleSources.STDOUT, ConsoleSources.STDERR]),
  line: z.string(),
});

export type MinecraftLogEvent = z.infer<typeof MinecraftLogEventSchema>;

export const MinecraftErrorEventSchema = z.object({
  slug: ClientSlugSchema,
  code: MinecraftErrorCodeSchema,
  message: z.string(),
});

export type MinecraftErrorEvent = z.infer<typeof MinecraftErrorEventSchema>;

export const InstallRequestSchema = z.object({
  slug: ClientSlugSchema,
  loader: LoaderChoiceSchema.optional(),
});

export type InstallRequest = z.infer<typeof InstallRequestSchema>;
