import type { CatalogKey } from '@shared/contracts/ids';
import type { StoreApi } from 'zustand';
import { create, type UseBoundStore } from 'zustand';

// Per-key runtime state projected from live IPC events. Each patch is merged,
// clearing progress on terminal statuses and the error on success; which fields
// get cleared is the config's only per-feature divergence.
type LiveStatus<TStatus extends string> = { status: TStatus };

type LiveStatusStoreModel<TState> = {
  entries: Record<string, TState>;
  patch: (key: CatalogKey, change: Partial<TState>) => void;
  reset: (key: CatalogKey) => void;
};

type LiveStatusStoreConfig<TStatus extends string, TState extends LiveStatus<TStatus>> = {
  // The state an unseen key starts from; also what `reset(key)` restores.
  default: TState;
  // Statuses whose patch clears `clearProgressFields`.
  terminalStatuses: ReadonlySet<TStatus>;
  clearProgressFields: Partial<TState>;
  // Statuses whose patch clears `clearErrorFields`.
  clearErrorStatuses: ReadonlySet<TStatus>;
  clearErrorFields: Partial<TState>;
};

export type LiveStatusStore<TStatus extends string, TState extends LiveStatus<TStatus>> = {
  useStore: UseBoundStore<StoreApi<LiveStatusStoreModel<TState>>>;
  default: TState;
  selectEntry: (
    key: CatalogKey | null | undefined,
  ) => (state: LiveStatusStoreModel<TState>) => TState;
};

export const createLiveStatusStore = <TStatus extends string, TState extends LiveStatus<TStatus>>(
  config: LiveStatusStoreConfig<TStatus, TState>,
): LiveStatusStore<TStatus, TState> => {
  const useStore = create<LiveStatusStoreModel<TState>>((set) => ({
    entries: {},
    patch: (key, change) =>
      set((state) => {
        const current = state.entries[key] ?? config.default;
        let merged: TState = { ...current, ...change };
        if (change.status && config.terminalStatuses.has(change.status)) {
          merged = { ...merged, ...config.clearProgressFields };
        }
        if (change.status && config.clearErrorStatuses.has(change.status)) {
          merged = { ...merged, ...config.clearErrorFields };
        }
        return { entries: { ...state.entries, [key]: merged } };
      }),
    reset: (key) => set((state) => ({ entries: { ...state.entries, [key]: config.default } })),
  }));

  const selectEntry =
    (key: CatalogKey | null | undefined) =>
    (state: LiveStatusStoreModel<TState>): TState =>
      (key && state.entries[key]) || config.default;

  return { useStore, default: config.default, selectEntry };
};
