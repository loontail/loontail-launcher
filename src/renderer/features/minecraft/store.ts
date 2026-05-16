import type { ClientSlug } from '@shared/contracts/ids';
import {
  type InstallStage,
  type InstallStatus,
  InstallStatuses,
  type MinecraftErrorCode,
} from '@shared/contracts/minecraft';
import { create } from 'zustand';

export type ClientRuntimeState = {
  status: InstallStatus;
  paused: boolean;
  stage?: InstallStage | undefined;
  stagePercent?: number | undefined;
  overallPercent?: number | undefined;
  bytesDownloaded?: number | undefined;
  totalBytes?: number | undefined;
  currentFile?: string | undefined;
  error?: { code: MinecraftErrorCode; message: string } | undefined;
};

export const DEFAULT_STATE: ClientRuntimeState = {
  status: InstallStatuses.UNKNOWN,
  paused: false,
};

type Store = {
  entries: Record<string, ClientRuntimeState>;
  patch: (slug: ClientSlug, change: Partial<ClientRuntimeState>) => void;
};

const STATUSES_WITHOUT_PROGRESS: ReadonlySet<InstallStatus> = new Set([
  InstallStatuses.INSTALLED,
  InstallStatuses.NOT_INSTALLED,
  InstallStatuses.RUNNING,
  InstallStatuses.ERROR,
  InstallStatuses.UNKNOWN,
]);

export const useMinecraftStore = create<Store>((set) => ({
  entries: {},
  patch: (slug, change) =>
    set((state) => {
      const current = state.entries[slug] ?? DEFAULT_STATE;
      const merged: ClientRuntimeState = { ...current, ...change };
      if (change.status && STATUSES_WITHOUT_PROGRESS.has(change.status)) {
        merged.stage = undefined;
        merged.stagePercent = undefined;
        merged.overallPercent = undefined;
        merged.currentFile = undefined;
      }
      return { entries: { ...state.entries, [slug]: merged } };
    }),
}));

export const selectClient =
  (slug: ClientSlug | null | undefined) =>
  (state: Store): ClientRuntimeState =>
    (slug && state.entries[slug]) || DEFAULT_STATE;
