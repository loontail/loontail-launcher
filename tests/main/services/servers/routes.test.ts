import { ERROR_CODES } from '@shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => loggerMocks,
}));

const serversMocks = vi.hoisted(() => ({
  getServerStatuses: vi.fn(async (_addresses: readonly (string | null)[]) => []),
}));

vi.mock('@main/services/servers/servers', () => ({
  getServerStatuses: serversMocks.getServerStatuses,
}));

import { registerServersRoutes } from '@main/services/servers/routes';
import { IPC_CHANNELS } from '@shared/ipc';
import { captureThrow, createTestRouter, type StoredHandler } from '../../../helpers/router';

const handler = (): StoredHandler => {
  const { router, handlers } = createTestRouter();
  registerServersRoutes(router);
  const found = handlers.get(IPC_CHANNELS.serversGetStatuses);
  if (!found) throw new Error('servers.getStatuses handler was not registered');
  return found;
};

const forwarded = (): readonly (string | null)[] =>
  serversMocks.getServerStatuses.mock.calls[0]?.[0] ?? [];

beforeEach(() => {
  serversMocks.getServerStatuses.mockClear();
  loggerMocks.warn.mockClear();
});

describe('registerServersRoutes payload guard', () => {
  it('accepts a realistic server list', async () => {
    await handler()(['mc.example.com', 'mc.example.com:25566', '[::1]:25566', '2001:db8::1']);

    expect(serversMocks.getServerStatuses).toHaveBeenCalledWith([
      'mc.example.com',
      'mc.example.com:25566',
      '[::1]:25566',
      '2001:db8::1',
    ]);
  });

  it('rejects a list longer than the cap instead of fanning out N dials', async () => {
    const addresses = Array.from({ length: 33 }, (_, index) => `host${index}.example.com`);

    const error = await captureThrow(() => handler()(addresses));

    expect(error).toMatchObject({ code: ERROR_CODES.IPC_INVALID_ARGS });
    expect(serversMocks.getServerStatuses).not.toHaveBeenCalled();
  });

  it('keeps the batch when one entry is unusable instead of failing the whole call', async () => {
    // `Server.address` is free text end-to-end, so one admin-entered URL used to
    // reject the whole payload and every server in the build lost its status.
    await handler()([
      'mc.example.com',
      'https://mc.example.com',
      'mc.example.com/../etc',
      'mc example.com',
      `${'a'.repeat(256)}.example.com`,
      'eu.example.com:25566',
    ]);

    expect(forwarded()).toEqual(['mc.example.com', null, null, null, null, 'eu.example.com:25566']);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Reporting unusable server addresses as offline',
      expect.objectContaining({ skipped: expect.any(Array) }),
    );
  });

  it('trims a stray whitespace instead of discarding the address', async () => {
    await handler()([' mc.example.com ', 'sérveur.example.com']);

    expect(forwarded()).toEqual(['mc.example.com', 'sérveur.example.com']);
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it('nulls out a non-string entry rather than rejecting the array', async () => {
    await handler()(['mc.example.com', 42, null]);

    expect(forwarded()).toEqual(['mc.example.com', null, null]);
  });

  it('bounds what a rejected address writes into the log file', async () => {
    // Launcher logs get attached to bug reports; the rejected values are
    // renderer-supplied and only length-checked for whether they become null.
    await handler()([`${'x'.repeat(1_000_000)} bad`, { nested: 'object' }]);

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Reporting unusable server addresses as offline',
      { skipped: ['x'.repeat(80), 'object'] },
    );
  });
});
