// @vitest-environment jsdom
import type { Server } from '@shared/contracts/media';
import type { ServerStatus } from '@shared/contracts/serverStatus';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getServerStatuses = vi.hoisted(() =>
  vi.fn<(addresses: string[]) => Promise<ServerStatus[]>>(),
);

vi.mock('@renderer/features/servers/api', () => ({ getServerStatuses }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { ServersInfo } = await import('@renderer/features/builds/components/ServersInfo');

const SERVERS: Server[] = [
  { id: 'server-alpha', name: 'Alpha', address: 'alpha.example.com' },
  { id: 'server-beta', name: 'Beta', address: 'beta.example.com' },
];

const online = (players: number): ServerStatus => ({
  online: true,
  players: { online: players, max: 100 },
});

let queryClient: QueryClient;

const renderServers = (servers: Server[] = SERVERS) =>
  render(
    <QueryClientProvider client={queryClient}>
      <ServersInfo servers={servers} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  getServerStatuses.mockReset();
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

// ServerStatus carries no address, so with a one-status-per-server response the
// positional and the by-address join are observationally identical. Only the
// duplicate-address case below tells them apart; the rest is regression cover on
// the rendered rows.
describe('ServersInfo', () => {
  it('renders each row with its own address and player counts', async () => {
    getServerStatuses.mockResolvedValue([online(7), online(42)]);

    const { container } = renderServers();

    await waitFor(() => expect(screen.getByText('Alpha')).toBeDefined());
    expect(container.textContent).toContain('alpha.example.com7 / 100');
    expect(container.textContent).toContain('beta.example.com42 / 100');
  });

  it('renders rows in server order, not response order', async () => {
    getServerStatuses.mockResolvedValue([online(7), online(42)]);

    renderServers();

    await waitFor(() => expect(screen.getByText('Alpha')).toBeDefined());
    const addresses = screen.getAllByText(/example\.com$/).map((element) => element.textContent);
    expect(addresses).toEqual(['alpha.example.com', 'beta.example.com']);
  });

  it('drops a server the response is too short to cover', async () => {
    getServerStatuses.mockResolvedValue([online(7)]);

    const { container } = renderServers();

    await waitFor(() => expect(screen.getByText('Alpha')).toBeDefined());
    expect(screen.queryByText('Beta')).toBeNull();
    expect(container.textContent).toContain('alpha.example.com7 / 100');
  });

  it('pings a repeated address once and shows that one status on every row', async () => {
    getServerStatuses.mockResolvedValue([online(7)]);

    const { container } = renderServers([
      { id: 'server-main', name: 'Main', address: 'main.example.com' },
      { id: 'server-alias', name: 'Main (EU alias)', address: 'main.example.com' },
    ]);

    await waitFor(() => expect(screen.getByText('Main')).toBeDefined());
    expect(getServerStatuses).toHaveBeenCalledTimes(1);
    expect(getServerStatuses).toHaveBeenCalledWith(['main.example.com']);
    expect(screen.getByText('Main (EU alias)')).toBeDefined();
    expect(container.textContent?.match(/7 \/ 100/g)).toHaveLength(2);
  });

  it('shows the aggregate offline row when nothing is online', async () => {
    getServerStatuses.mockResolvedValue([{ online: false }, { online: false }]);

    renderServers();

    await waitFor(() => expect(screen.getByText('servers.offline')).toBeDefined());
  });

  it('shows a status-unavailable row instead of endless skeletons when the query fails', async () => {
    getServerStatuses.mockRejectedValue(new Error('ipc/invalid-args'));

    const { container } = renderServers();

    await waitFor(() => expect(screen.getByText('servers.statusUnavailable')).toBeDefined());
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });
});
