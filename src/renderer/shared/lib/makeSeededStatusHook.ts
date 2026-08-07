import type { StatusSeeder } from '@renderer/shared/lib/statusSeeder';
import type { LiveStatusStore } from '@renderer/shared/lib/stores/createLiveStatusStore';
import type { CatalogKey } from '@shared/contracts/ids';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

type SeededStatusHookConfig<TState extends { status: string }, TSeed> = {
  store: Pick<LiveStatusStore<string, TState>, 'useStore' | 'selectEntry'>;
  seeder: StatusSeeder<TSeed>;
  toPatch: (seed: TSeed) => Partial<TState>;
  // Prefixes the best-effort warning logged when a seed rejects.
  label: string;
  onSeeded?: (queryClient: QueryClient) => void;
};

export const makeSeededStatusHook = <TState extends { status: string }, TSeed>({
  store,
  seeder,
  toPatch,
  label,
  onSeeded,
}: SeededStatusHookConfig<TState, TSeed>) => {
  const peek = () => store.useStore.getState();

  return (key: CatalogKey | null | undefined): TState => {
    const state = store.useStore(store.selectEntry(key));
    const queryClient = useQueryClient();

    useEffect(() => {
      if (!key) return;
      // Live events are the source of truth, so seed only while the store has no
      // entry — and check again after the await in case an event landed while the
      // seed was in flight. Both reads stay reads: subscribing here would
      // re-render every card on any other key's change.
      if (peek().entries[key]) return;
      void seeder
        .seedStatus(key)
        .then((seed) => {
          if (peek().entries[key]) return;
          peek().patch(key, toPatch(seed));
          onSeeded?.(queryClient);
        })
        .catch((error: unknown) => {
          // biome-ignore lint/suspicious/noConsole: best-effort seed — main logger unreachable from renderer
          console.warn(`[${label}] failed to seed status`, error);
        });
    }, [queryClient, key]);

    return state;
  };
};
