import { z } from 'zod';
import { enumFromConst } from './enum';
import { BundleSlugSchema, CatalogKeySchema } from './ids';

export const BundleSyncStatuses = {
  UNKNOWN: 'unknown',
  IDLE: 'idle',
  FETCHING_MANIFEST: 'fetching-manifest',
  PLANNING: 'planning',
  DOWNLOADING: 'downloading',
  DELETING: 'deleting',
  HEALING: 'healing',
  COMPLETED: 'completed',
  UP_TO_DATE: 'up-to-date',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
  ERROR: 'error',
  NO_BUNDLE: 'no-bundle',
} as const;

export type BundleSyncStatus = (typeof BundleSyncStatuses)[keyof typeof BundleSyncStatuses];

export const BundleSyncStatusSchema = enumFromConst(BundleSyncStatuses);

// Statuses that gate the start/launch buttons while a sync is in flight.
export const BUSY_BUNDLE_STATUSES: ReadonlySet<BundleSyncStatus> = new Set([
  BundleSyncStatuses.FETCHING_MANIFEST,
  BundleSyncStatuses.PLANNING,
  BundleSyncStatuses.DOWNLOADING,
  BundleSyncStatuses.DELETING,
  BundleSyncStatuses.HEALING,
]);

export const BundleErrorCodes = {
  NO_CLIENT_FOLDER: 'bundle/noClientFolder',
  MANIFEST_FETCH_FAILED: 'bundle/manifestFetchFailed',
  MANIFEST_INVALID: 'bundle/manifestInvalid',
  DOWNLOAD_FAILED: 'bundle/downloadFailed',
  DOWNLOAD_INTEGRITY_FAILED: 'bundle/downloadIntegrityFailed',
  DELETE_FAILED: 'bundle/deleteFailed',
  UNSAFE_PATH: 'bundle/unsafePath',
  HEAL_FAILED: 'bundle/healFailed',
  ABORTED: 'bundle/aborted',
  OP_IN_FLIGHT: 'bundle/opInFlight',
  UNKNOWN: 'bundle/unknown',
} as const;

export type BundleErrorCode = (typeof BundleErrorCodes)[keyof typeof BundleErrorCodes];

export const BundleErrorCodeSchema = enumFromConst(BundleErrorCodes);

// Single file in a bundle-registry build manifest, mirroring the backend entry shape.
export const RemoteManifestEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  isDir: z.boolean(),
  sha256: z.string().optional(),
  url: z.string().optional(),
  downloadOnce: z.boolean().optional(),
});

export type RemoteManifestEntry = z.infer<typeof RemoteManifestEntrySchema>;

// Keyed by category (first path segment, or "root"); values are file lists.
export const RemoteManifestSchema = z.record(z.string(), z.array(RemoteManifestEntrySchema));

export type RemoteManifest = z.infer<typeof RemoteManifestSchema>;

export const LocalManifestFileSchema = z.object({
  sha256: z.string(),
  size: z.number().int().nonnegative(),
});

export const LocalManifestSchema = z.object({
  bundleSlug: BundleSlugSchema,
  // SHA-256 of the raw remote manifest JSON we synced from, for cheap
  // upstream-change detection on the next getStatus.
  manifestHash: z.string(),
  syncedAt: z.string(),
  files: z.record(z.string(), LocalManifestFileSchema),
});

export type LocalManifest = z.infer<typeof LocalManifestSchema>;

export const BundleStatusEventSchema = z.object({
  key: CatalogKeySchema,
  status: BundleSyncStatusSchema,
});

export type BundleStatusEvent = z.infer<typeof BundleStatusEventSchema>;

export const BundleProgressEventSchema = z.object({
  key: CatalogKeySchema,
  status: BundleSyncStatusSchema,
  processedFiles: z.number().int().nonnegative(),
  totalFiles: z.number().int().nonnegative(),
  toDownload: z.number().int().nonnegative(),
  toUpdate: z.number().int().nonnegative(),
  toDelete: z.number().int().nonnegative(),
  toSkip: z.number().int().nonnegative(),
  bytesDownloaded: z.number().int().nonnegative(),
  bytesTotal: z.number().int().nonnegative(),
  currentFile: z.string().optional(),
});

export type BundleProgressEvent = z.infer<typeof BundleProgressEventSchema>;

export const BundleErrorEventSchema = z.object({
  key: CatalogKeySchema,
  code: BundleErrorCodeSchema,
  message: z.string(),
});

export type BundleErrorEvent = z.infer<typeof BundleErrorEventSchema>;

export type BundleInstallState = {
  // True only when a successful sync has produced a local manifest on disk.
  installed: boolean;
  // False signals "bundle update available". Assumes match when the remote
  // manifest couldn't be fetched, to avoid spurious update affordances.
  signatureMatches: boolean;
  progress: BundleProgressEvent | null;
};

export const BundleStartRequestSchema = z.object({
  key: CatalogKeySchema,
  force: z.boolean().optional(),
});

export type BundleStartRequest = z.infer<typeof BundleStartRequestSchema>;
