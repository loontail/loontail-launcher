import type { CatalogKey } from '@shared/contracts/ids';
import { type UseBoundStore, create } from 'zustand';
import type { StoreApi } from 'zustand';

// Per-slug runtime state projected from live IPC events, shared by the minecraft
// and bundle features. Both stores keep a `Record<slug, state>` and merge each
// patch, clearing progress on terminal statuses and the error on success — the
// only divergence is *which* fields get cleared, captured by the config patches.
type RuntimeState<TStatus extends string> = { status: TStatus };

type RuntimeStoreModel<TState> = {
  entries: Record<string, TState>;
  patch: (slug: CatalogKey, change: Partial<TState>) => void;
  reset: (slug: CatalogKey) => void;
};

type RuntimeStoreConfig<TStatus extends string, TState extends RuntimeState<TStatus>> = {
  // The state an unseen slug starts from; also what `reset(slug)` restores.
  default: TState;
  // Statuses that end an operation — their patch clears the in-flight progress
  // fields via `clearProgressFields`.
  terminalStatuses: ReadonlySet<TStatus>;
  // The progress fields to clear (to undefined/null) on a terminal status.
  clearProgressFields: Partial<TState>;
  // Statuses that represent a clean success — their patch clears the error (and
  // any extra success fields) via `clearErrorFields`.
  clearErrorStatuses: ReadonlySet<TStatus>;
  // The fields to clear/restore on a clean-success status.
  clearErrorFields: Partial<TState>;
};

export type RuntimeStore<TStatus extends string, TState extends RuntimeState<TStatus>> = {
  useStore: UseBoundStore<StoreApi<RuntimeStoreModel<TState>>>;
  default: TState;
  selectEntry: (
    slug: CatalogKey | null | undefined,
  ) => (state: RuntimeStoreModel<TState>) => TState;
};

export const createRuntimeStore = <TStatus extends string, TState extends RuntimeState<TStatus>>(
  config: RuntimeStoreConfig<TStatus, TState>,
): RuntimeStore<TStatus, TState> => {
  const useStore = create<RuntimeStoreModel<TState>>((set) => ({
    entries: {},
    patch: (slug, change) =>
      set((state) => {
        const current = state.entries[slug] ?? config.default;
        let merged: TState = { ...current, ...change };
        if (change.status && config.terminalStatuses.has(change.status)) {
          merged = { ...merged, ...config.clearProgressFields };
        }
        if (change.status && config.clearErrorStatuses.has(change.status)) {
          merged = { ...merged, ...config.clearErrorFields };
        }
        return { entries: { ...state.entries, [slug]: merged } };
      }),
    reset: (slug) => set((state) => ({ entries: { ...state.entries, [slug]: config.default } })),
  }));

  const selectEntry =
    (slug: CatalogKey | null | undefined) =>
    (state: RuntimeStoreModel<TState>): TState =>
      (slug && state.entries[slug]) || config.default;

  return { useStore, default: config.default, selectEntry };
};
