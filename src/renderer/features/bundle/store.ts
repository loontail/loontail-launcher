import {
  BUSY_BUNDLE_STATUSES,
  type BundleErrorCode,
  type BundleProgressEvent,
  type BundleSyncStatus,
  BundleSyncStatuses,
} from '@shared/contracts/bundle';
import type { CatalogKey } from '@shared/contracts/ids';
import { create } from 'zustand';

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

type Store = {
  entries: Record<string, BundleRuntimeState>;
  patch: (slug: CatalogKey, change: Partial<BundleRuntimeState>) => void;
  reset: (slug: CatalogKey) => void;
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

export const useBundleStore = create<Store>((set) => ({
  entries: {},
  patch: (slug, change) =>
    set((state) => {
      const current = state.entries[slug] ?? DEFAULT_BUNDLE_STATE;
      const merged: BundleRuntimeState = { ...current, ...change };
      if (change.status && TERMINAL_STATUSES.has(change.status)) {
        merged.progress = null;
      }
      if (change.status && STATUSES_CLEAR_ERROR.has(change.status)) {
        merged.error = undefined;
        merged.installed = true;
        merged.signatureMatches = true;
      }
      return { entries: { ...state.entries, [slug]: merged } };
    }),
  reset: (slug) =>
    set((state) => ({ entries: { ...state.entries, [slug]: DEFAULT_BUNDLE_STATE } })),
}));

export const selectBundle =
  (slug: CatalogKey | null | undefined) =>
  (state: Store): BundleRuntimeState =>
    (slug && state.entries[slug]) || DEFAULT_BUNDLE_STATE;

export const isBundleBusy = (status: BundleSyncStatus): boolean =>
  BUSY_BUNDLE_STATUSES.has(status) || status === BundleSyncStatuses.PAUSED;
