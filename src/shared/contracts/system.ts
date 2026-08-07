import { z } from 'zod';

// Codes on the `system.*` reject path. Namespaced like every other registry so
// the same string can never mean two subsystems (see tests/shared/contracts/errorCodes).
export const SystemErrorCodes = {
  PATH_NOT_ALLOWED: 'system/pathNotAllowed',
  DISK_PROBE_FAILED: 'system/diskProbeFailed',
} as const;

export type SystemErrorCode = (typeof SystemErrorCodes)[keyof typeof SystemErrorCodes];

// A resolved probe always carries the numbers; a refused path or a failed probe
// rejects with a SystemErrorCode instead of resolving a half-empty record.
export const DiskInfoSchema = z.object({
  path: z.string(),
  diskPath: z.string().optional(),
  free: z.number(),
  size: z.number(),
});

export type DiskInfo = z.infer<typeof DiskInfoSchema>;

export const FolderSizeSchema = z.object({
  path: z.string(),
  bytes: z.number().nullable(),
});

export type FolderSize = z.infer<typeof FolderSizeSchema>;

export const PickedFolderSchema = z.object({
  path: z.string(),
  diskPath: z.string().optional(),
  free: z.number().optional(),
  size: z.number().optional(),
});

export type PickedFolder = z.infer<typeof PickedFolderSchema>;
