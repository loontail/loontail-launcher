// @vitest-environment jsdom
import { QUERY_KEYS } from '@shared/constants';
import { asCatalogKey } from '@shared/contracts/ids';
import { type InstallStatus, InstallStatuses } from '@shared/contracts/minecraft';
import { IPC_EVENTS } from '@shared/ipc';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

vi.mock('@renderer/i18n', () => ({ i18n: { t: (key: string) => key } }));
vi.mock('@renderer/features/minecraft/api', () => ({ repair: vi.fn() }));

const { MinecraftEventsListener } = await import('@renderer/features/minecraft/events');

const KEY = asCatalogKey('official:test-client');

type StatusHandler = (payload: { key: string; status: InstallStatus }) => void;

let queryClient: QueryClient;
let invalidateSpy: MockInstance<QueryClient['invalidateQueries']>;
let statusHandlers: StatusHandler[];

beforeEach(() => {
  statusHandlers = [];
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
  window.api = {
    on: (channel: string, handler: unknown) => {
      if (channel === IPC_EVENTS.minecraftStatus) statusHandlers.push(handler as StatusHandler);
      return () => {};
    },
  } as unknown as typeof window.api;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  queryClient.clear();
});

const emitStatus = (status: InstallStatus) => {
  render(
    <QueryClientProvider client={queryClient}>
      <MinecraftEventsListener />
    </QueryClientProvider>,
  );
  for (const handler of statusHandlers) handler({ key: KEY, status });
};

const invalidatedKeys = () =>
  invalidateSpy.mock.calls.map(
    ([argument]) => (argument as { queryKey: readonly unknown[] }).queryKey,
  );

describe('MinecraftEventsListener settings invalidation', () => {
  it('refetches launcher settings on RUNNING, since main persists overrides while building the launch context', () => {
    emitStatus(InstallStatuses.RUNNING);

    expect(invalidatedKeys()).toContainEqual(QUERY_KEYS.settings.root);
  });

  it('refetches launcher settings on the install/uninstall terminal statuses', () => {
    emitStatus(InstallStatuses.INSTALLED);
    expect(invalidatedKeys()).toContainEqual(QUERY_KEYS.settings.root);

    invalidateSpy.mockClear();
    cleanup();
    statusHandlers = [];

    emitStatus(InstallStatuses.NOT_INSTALLED);
    expect(invalidatedKeys()).toContainEqual(QUERY_KEYS.settings.root);
  });

  it('leaves settings alone on a transient progress status', () => {
    emitStatus(InstallStatuses.INSTALLING);

    expect(invalidatedKeys()).not.toContainEqual(QUERY_KEYS.settings.root);
  });
});
