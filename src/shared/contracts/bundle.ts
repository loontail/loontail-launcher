import { z } from 'zod';
import { enumFromConst } from './enum';
import { BundleSlugSchema, CatalogKeySchema } from './ids';

// Stable string constants for the lifecycle of a bundle sync. The renderer
// reads these to decide what affordance to show (Download / Pause / Resume /
// Retry / Repair / Play).
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

// Statuses where a bundle sync is actively progressing. Renderer disables
// start/launch buttons while any of these are active.
export const BUSY_BUNDLE_STATUSES: ReadonlySet<BundleSyncStatus> = new Set([
  BundleSyncStatuses.FETCHING_MANIFEST,
  BundleSyncStatuses.PLANNING,
  BundleSyncStatuses.DOWNLOADING,
  BundleSyncStatuses.DELETING,
  BundleSyncStatuses.HEALING,
]);

export const BundleErrorCodes = {
  NO_CLIENT_FOLDER: 'noClientFolder',
  MANIFEST_FETCH_FAILED: 'manifestFetchFailed',
  MANIFEST_INVALID: 'manifestInvalid',
  DOWNLOAD_FAILED: 'downloadFailed',
  DOWNLOAD_INTEGRITY_FAILED: 'downloadIntegrityFailed',
  DELETE_FAILED: 'deleteFailed',
  UNSAFE_PATH: 'unsafePath',
  HEAL_FAILED: 'healFailed',
  ABORTED: 'aborted',
  OP_IN_FLIGHT: 'opInFlight',
  UNKNOWN: 'unknown',
} as const;

export type BundleErrorCode = (typeof BundleErrorCodes)[keyof typeof BundleErrorCodes];

export const BundleErrorCodeSchema = enumFromConst(BundleErrorCodes);

// Single file in a bundle-registry build manifest. Mirrors plugin's ManifestEntry.
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

// Categories from plugin (first path segment or "root"); values are file lists.
export const RemoteManifestSchema = z.record(z.string(), z.array(RemoteManifestEntrySchema));

export type RemoteManifest = z.infer<typeof RemoteManifestSchema>;

export const LocalManifestFileSchema = z.object({
  sha256: z.string(),
  size: z.number().int().nonnegative(),
});

export const LocalManifestSchema = z.object({
  bundleSlug: BundleSlugSchema,
  // SHA-256 of the raw remote manifest JSON we synced from. Lets the renderer
  // detect "manifest changed upstream" cheaply on next checkStatus.
  manifestHash: z.string(),
  syncedAt: z.string(),
  files: z.record(z.string(), LocalManifestFileSchema),
});

export type LocalManifest = z.infer<typeof LocalManifestSchema>;

export const BundleStatusEventSchema = z.object({
  slug: CatalogKeySchema,
  status: BundleSyncStatusSchema,
});

export type BundleStatusEvent = z.infer<typeof BundleStatusEventSchema>;

export const BundleProgressEventSchema = z.object({
  slug: CatalogKeySchema,
  status: BundleSyncStatusSchema,
  processedFiles: z.number().int().nonnegative(),
  totalFiles: z.number().int().nonnegative(),
  toDownload: z.number().int().nonnegative(),
  toUpdate: z.number().int().nonnegative(),
  toDelete: z.number().int().nonnegative(),
  toSkip: z.number().int().nonnegative(),
  bytesDownloaded: z.number().int().nonnegative(),
  bytesTotal: z.number().int().nonnegative(),
  speedBytesPerSec: z.number().nonnegative(),
  currentFile: z.string().optional(),
});

export type BundleProgressEvent = z.infer<typeof BundleProgressEventSchema>;

export const BundleErrorEventSchema = z.object({
  slug: CatalogKeySchema,
  code: BundleErrorCodeSchema,
  message: z.string(),
});

export type BundleErrorEvent = z.infer<typeof BundleErrorEventSchema>;

// Reply for bundle.checkStatus — used by renderer to seed initial UI state.
export type BundleInstallState = {
  // True only when a successful sync has produced a local manifest on disk.
  installed: boolean;
  // True when the cached local manifest hash matches the latest remote manifest
  // hash (or when we couldn't fetch — assume match to avoid spurious "update"
  // affordances). False signals "bundle update available".
  signatureMatches: boolean;
  // Current status when a sync is in flight; null otherwise.
  progress: BundleProgressEvent | null;
};

export const BundleStartRequestSchema = z.object({
  slug: CatalogKeySchema,
  force: z.boolean().optional(),
});

export type BundleStartRequest = z.infer<typeof BundleStartRequestSchema>;
