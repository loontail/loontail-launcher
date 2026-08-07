import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => loggerMocks,
}));

type Dial = { host: string; port: number };

const netMocks = vi.hoisted(() => {
  const dials: { host: string; port: number }[] = [];
  const live: { settle: () => void }[] = [];
  return { dials, live, autoSettle: { value: true } };
});

vi.mock('node:net', async () => {
  const actual = await vi.importActual<typeof import('node:net')>('node:net');
  const connect = (options: Dial): unknown => {
    netMocks.dials.push({ host: options.host, port: options.port });
    const socket = new EventEmitter() as EventEmitter & {
      setTimeout: () => void;
      write: () => void;
      destroy: () => void;
    };
    socket.setTimeout = () => undefined;
    socket.write = () => undefined;
    socket.destroy = () => undefined;
    const settle = (): void => {
      socket.emit('error', new Error('ECONNREFUSED'));
    };
    if (netMocks.autoSettle.value) {
      setImmediate(settle);
    } else {
      netMocks.live.push({ settle });
    }
    return socket;
  };
  const mocked = { ...actual, connect };
  return { ...mocked, default: mocked };
});

const dnsMocks = vi.hoisted(() => ({ resolveSrv: vi.fn() }));

vi.mock('node:dns', () => ({ promises: { resolveSrv: dnsMocks.resolveSrv } }));

import { getServerStatuses } from '@main/services/servers/servers';

beforeEach(() => {
  netMocks.dials.length = 0;
  netMocks.live.length = 0;
  netMocks.autoSettle.value = true;
  dnsMocks.resolveSrv.mockReset().mockRejectedValue(new Error('ENOTFOUND'));
  loggerMocks.warn.mockClear();
});

describe('getServerStatuses address parsing', () => {
  it('dials the default port and tries SRV for a bare hostname', async () => {
    await getServerStatuses(['mc.example.com']);

    expect(dnsMocks.resolveSrv).toHaveBeenCalledWith('_minecraft._tcp.mc.example.com');
    expect(netMocks.dials).toEqual([{ host: 'mc.example.com', port: 25565 }]);
  });

  it('uses an explicit port and skips the SRV lookup', async () => {
    await getServerStatuses(['mc.example.com:25566']);

    expect(dnsMocks.resolveSrv).not.toHaveBeenCalled();
    expect(netMocks.dials).toEqual([{ host: 'mc.example.com', port: 25566 }]);
  });

  it('prefers the lowest-priority SRV record', async () => {
    dnsMocks.resolveSrv.mockResolvedValue([
      { name: 'backup.example.com', port: 25570, priority: 10, weight: 1 },
      { name: 'primary.example.com', port: 25571, priority: 1, weight: 1 },
    ]);

    await getServerStatuses(['mc.example.com']);

    expect(netMocks.dials).toEqual([{ host: 'primary.example.com', port: 25571 }]);
  });

  it('parses a bracketed IPv6 literal with a port', async () => {
    await getServerStatuses(['[::1]:25566']);

    expect(dnsMocks.resolveSrv).not.toHaveBeenCalled();
    expect(netMocks.dials).toEqual([{ host: '::1', port: 25566 }]);
  });

  it('parses a bare IPv6 literal instead of splitting it on the first colon', async () => {
    // `address.split(':')` dialed host "2001" on the default port and asked for
    // SRV records of `_minecraft._tcp.2001`, so any IPv6 server read as offline.
    await getServerStatuses(['2001:db8::1']);

    expect(dnsMocks.resolveSrv).not.toHaveBeenCalled();
    expect(netMocks.dials).toEqual([{ host: '2001:db8::1', port: 25565 }]);
  });

  it('never dials an out-of-range or zero port', async () => {
    const statuses = await getServerStatuses(['mc.example.com:99999', 'mc.example.com:0']);

    expect(statuses).toEqual([{ online: false }, { online: false }]);
    expect(netMocks.dials).toEqual([]);
  });

  it('reports an entry the IPC boundary rejected as offline without dialing it', async () => {
    const statuses = await getServerStatuses(['a.example.com:1', null, 'b.example.com:2']);

    expect(statuses).toEqual([{ online: false }, { online: false }, { online: false }]);
    expect(netMocks.dials).toEqual([
      { host: 'a.example.com', port: 1 },
      { host: 'b.example.com', port: 2 },
    ]);
  });

  it('keeps results index-paired with the requested addresses', async () => {
    const statuses = await getServerStatuses(['a.example.com', 'b.example.com:1', 'bad:99999']);

    expect(statuses).toHaveLength(3);
    // Dial order follows resolution timing (the SRV probe delays the first
    // address); only the result order is contractual.
    expect(netMocks.dials).toHaveLength(2);
    expect(netMocks.dials).toEqual(
      expect.arrayContaining([
        { host: 'a.example.com', port: 25565 },
        { host: 'b.example.com', port: 1 },
      ]),
    );
  });
});

describe('getServerStatuses fan-out', () => {
  it('caps concurrent dials instead of opening one socket per address', async () => {
    netMocks.autoSettle.value = false;
    const addresses = Array.from({ length: 20 }, (_, index) => `host${index}.example.com:25565`);

    const pending = getServerStatuses(addresses);
    // Let the limiter release its first batch.
    await new Promise((resolve) => setImmediate(resolve));

    expect(netMocks.dials).toHaveLength(8);

    for (const socket of [...netMocks.live]) socket.settle();
    netMocks.live.length = 0;
    await new Promise((resolve) => setImmediate(resolve));
    expect(netMocks.dials.length).toBeLessThanOrEqual(16);

    netMocks.autoSettle.value = true;
    for (const socket of [...netMocks.live]) socket.settle();
    await pending;
  });
});
