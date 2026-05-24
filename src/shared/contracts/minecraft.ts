import type { ProgressStage } from '@loontail/minecraft-kit';
import { z } from 'zod';
import { ConsoleSources } from './console';
import { ClientSlugSchema } from './ids';
import { LoaderChoiceSchema } from './settings';

export type { ProgressStage } from '@loontail/minecraft-kit';

export const InstallStatuses = {
  UNKNOWN: 'unknown',
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

export const InstallStatusSchema = z.enum([
  InstallStatuses.UNKNOWN,
  InstallStatuses.NOT_INSTALLED,
  InstallStatuses.INSTALLING,
  InstallStatuses.INSTALLED,
  InstallStatuses.LAUNCHING,
  InstallStatuses.RUNNING,
  InstallStatuses.REPAIRING,
  InstallStatuses.UNINSTALLING,
  InstallStatuses.ERROR,
]);

export const ProgressStages = {
  PREPARE: 'prepare',
  RUNTIME: 'runtime',
  MINECRAFT: 'minecraft',
  LOADER: 'loader',
  FINALIZE: 'finalize',
} as const satisfies Record<string, ProgressStage>;

export const ProgressStageSchema = z.enum([
  ProgressStages.PREPARE,
  ProgressStages.RUNTIME,
  ProgressStages.MINECRAFT,
  ProgressStages.LOADER,
  ProgressStages.FINALIZE,
]);

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
  UNKNOWN: 'unknown',
} as const;

export type MinecraftErrorCode = (typeof MinecraftErrorCodes)[keyof typeof MinecraftErrorCodes];

export const MinecraftErrorCodeSchema = z.enum([
  MinecraftErrorCodes.NO_ACCOUNT,
  MinecraftErrorCodes.NO_CLIENT_FOLDER,
  MinecraftErrorCodes.LOADER_AMBIGUOUS,
  MinecraftErrorCodes.OP_IN_FLIGHT,
  MinecraftErrorCodes.NOT_INSTALLED,
  MinecraftErrorCodes.ABORTED,
  MinecraftErrorCodes.NETWORK_ERROR,
  MinecraftErrorCodes.INTEGRITY_ERROR,
  MinecraftErrorCodes.RUNTIME_ERROR,
  MinecraftErrorCodes.LAUNCH_FAILED,
  MinecraftErrorCodes.KIT_ERROR,
  MinecraftErrorCodes.UNKNOWN,
]);

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
