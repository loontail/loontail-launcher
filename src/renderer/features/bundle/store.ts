import { createRuntimeStore } from '@renderer/shared/lib/stores/createRuntimeStore';
import {
  BUSY_BUNDLE_STATUSES,
  type BundleErrorCode,
  type BundleProgressEvent,
  type BundleSyncStatus,
  BundleSyncStatuses,
} from '@shared/contracts/bundle';

export type BundleRuntimeState = {
  status: BundleSyncStatus;
  installed: boolean;
  signatureMatches: boolean;
  progress: BundleProgressEvent | null;
  error?: { code: BundleErrorCode; message: string } | undefined;
};

export const DEFAULT_BUNDLE_STATE: BundleRuntimeState = {
  status: BundleSyncStatuses.UNKNOWN,
  installed: false,
  signatureMatches: true,
  progress: null,
};

const TERMINAL_STATUSES: ReadonlySet<BundleSyncStatus> = new Set([
  BundleSyncStatuses.COMPLETED,
  BundleSyncStatuses.UP_TO_DATE,
  BundleSyncStatuses.NO_BUNDLE,
  BundleSyncStatuses.CANCELLED,
  BundleSyncStatuses.ERROR,
]);

const STATUSES_CLEAR_ERROR: ReadonlySet<BundleSyncStatus> = new Set([
  BundleSyncStatuses.COMPLETED,
  BundleSyncStatuses.UP_TO_DATE,
  BundleSyncStatuses.NO_BUNDLE,
]);

const store = createRuntimeStore<BundleSyncStatus, BundleRuntimeState>({
  default: DEFAULT_BUNDLE_STATE,
  terminalStatuses: TERMINAL_STATUSES,
  clearProgressFields: { progress: null },
  clearErrorStatuses: STATUSES_CLEAR_ERROR,
  clearErrorFields: { error: undefined, installed: true, signatureMatches: true },
});

export const useBundleStore = store.useStore;
export const selectBundle = store.selectEntry;

export const isBundleBusy = (status: BundleSyncStatus): boolean =>
  BUSY_BUNDLE_STATUSES.has(status) || status === BundleSyncStatuses.PAUSED;
