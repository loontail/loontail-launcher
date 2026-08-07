// @vitest-environment jsdom
import { makeSeededStatusHook } from '@renderer/shared/lib/makeSeededStatusHook';
import { createLiveStatusStore } from '@renderer/shared/lib/stores/createLiveStatusStore';
import { asCatalogKey } from '@shared/contracts/ids';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TestState = { status: 'unknown' | 'ready'; installed: boolean };

const DEFAULT_STATE: TestState = { status: 'unknown', installed: false };

const KEY = asCatalogKey('official:alpha');

const makeStore = () =>
  createLiveStatusStore<TestState['status'], TestState>({
    default: DEFAULT_STATE,
    terminalStatuses: new Set(['ready']),
    clearProgressFields: {},
    clearErrorStatuses: new Set(),
    clearErrorFields: {},
  });

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

describe('makeSeededStatusHook', () => {
  it('seeds an unseen key and patches the store', async () => {
    const store = makeStore();
    const seedStatus = vi.fn(async () => ({ status: 'ready' as const, installed: true }));
    const useStatus = makeSeededStatusHook({
      store: { useStore: store.useStore, selectEntry: store.selectEntry },
      seeder: { seedStatus },
      toPatch: (seed) => seed,
      label: 'test',
    });

    const { result } = renderHook(() => useStatus(KEY), { wrapper });

    await waitFor(() => expect(result.current.installed).toBe(true));
    expect(seedStatus).toHaveBeenCalledWith(KEY);
  });

  it('does not seed when the store already has an entry', () => {
    const store = makeStore();
    store.useStore.getState().patch(KEY, { status: 'ready', installed: true });
    const seedStatus = vi.fn(async () => ({ status: 'ready' as const, installed: false }));
    const useStatus = makeSeededStatusHook({
      store: { useStore: store.useStore, selectEntry: store.selectEntry },
      seeder: { seedStatus },
      toPatch: (seed) => seed,
      label: 'test',
    });

    renderHook(() => useStatus(KEY), { wrapper });

    expect(seedStatus).not.toHaveBeenCalled();
  });

  it('does not seed for a null key', () => {
    const store = makeStore();
    const seedStatus = vi.fn(async () => ({ status: 'ready' as const, installed: true }));
    const useStatus = makeSeededStatusHook({
      store: { useStore: store.useStore, selectEntry: store.selectEntry },
      seeder: { seedStatus },
      toPatch: (seed) => seed,
      label: 'test',
    });

    const { result } = renderHook(() => useStatus(null), { wrapper });

    expect(seedStatus).not.toHaveBeenCalled();
    expect(result.current).toEqual(DEFAULT_STATE);
  });

  it('lets a live event that lands mid-seed win over the seed', async () => {
    const store = makeStore();
    let releaseSeed: () => void = () => {};
    const seedStatus = vi.fn(
      () =>
        new Promise<TestState>((resolve) => {
          releaseSeed = () => resolve({ status: 'unknown', installed: false });
        }),
    );
    const useStatus = makeSeededStatusHook({
      store: { useStore: store.useStore, selectEntry: store.selectEntry },
      seeder: { seedStatus },
      toPatch: (seed) => seed,
      label: 'test',
    });

    const { result } = renderHook(() => useStatus(KEY), { wrapper });
    // The live event arrives before the seed resolves.
    store.useStore.getState().patch(KEY, { status: 'ready', installed: true });
    releaseSeed();

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.installed).toBe(true);
  });

  it('runs onSeeded only when the seed resolves', async () => {
    const store = makeStore();
    const onSeeded = vi.fn();
    const useStatus = makeSeededStatusHook({
      store: { useStore: store.useStore, selectEntry: store.selectEntry },
      seeder: { seedStatus: async () => ({ status: 'ready' as const, installed: true }) },
      toPatch: (seed) => seed,
      label: 'test',
      onSeeded,
    });

    const { result } = renderHook(() => useStatus(KEY), { wrapper });

    await waitFor(() => expect(result.current.installed).toBe(true));
    expect(onSeeded).toHaveBeenCalledWith(queryClient);
  });

  it('warns and leaves the store untouched when the seed rejects', async () => {
    const store = makeStore();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onSeeded = vi.fn();
    const useStatus = makeSeededStatusHook({
      store: { useStore: store.useStore, selectEntry: store.selectEntry },
      seeder: { seedStatus: () => Promise.reject(new Error('ipc down')) },
      toPatch: (seed: TestState) => seed,
      label: 'test',
      onSeeded,
    });

    const { result } = renderHook(() => useStatus(KEY), { wrapper });

    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(result.current).toEqual(DEFAULT_STATE);
    expect(store.useStore.getState().entries[KEY]).toBeUndefined();
    expect(onSeeded).not.toHaveBeenCalled();
  });
});
