import { promises as dns } from 'node:dns';
import net from 'node:net';
import { createLimiter } from '@main/infra/concurrency';
import { scopedLogger } from '@main/infra/logger';
import type { ServerStatus } from '@shared/contracts/serverStatus';
import {
  buildHandshakeFrame,
  buildStatusRequestFrame,
  tryParseStatusResponse,
} from './serversProtocol';

const MINECRAFT_DEFAULT_PORT = 25565;
const SERVER_PING_TIMEOUT_MS = 4000;
const OFFLINE: ServerStatus = { online: false };

// A build's server list is renderer-supplied, so the fan-out is capped: N
// unbounded parallel sockets exhaust file descriptors, and a 200-server list
// would fire 200 simultaneous dials from every client viewing the page.
const PING_CONCURRENCY = 8;

const logger = scopedLogger('servers');

// `host`, `host:port`, `[v6]:port` or a bare IPv6 literal. Splitting on ':' broke
// every IPv6 form ('2001:db8::1' dialed host "2001" on the default port).
const ADDRESS_PATTERN = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/;

const MIN_PORT = 1;
const MAX_PORT = 65535;

const isIpLiteral = (host: string): boolean =>
  net.isIP(host) !== 0 || host.startsWith('[') || host.includes(':');

const parseAddress = (address: string): { host: string; port: number | null } | null => {
  // A bare IPv6 literal has no bracket/port form to parse.
  if (net.isIPv6(address)) return { host: address, port: null };
  const match = ADDRESS_PATTERN.exec(address);
  if (!match) return null;
  const rawHost = match[1] ?? '';
  const host = rawHost.startsWith('[') ? rawHost.slice(1, -1) : rawHost;
  if (!host) return null;
  if (match[2] === undefined) return { host, port: null };
  const port = Number(match[2]);
  // `Number('99999')` is finite and reached net.connect, which throws
  // ERR_SOCKET_BAD_PORT; reject the address instead of a mystery offline.
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) return null;
  return { host, port };
};

const resolveAddress = async (address: string): Promise<{ host: string; port: number } | null> => {
  const parsed = parseAddress(address);
  if (!parsed) return null;
  const { host, port } = parsed;
  if (port !== null) return { host, port };
  // SRV lookups only make sense for a hostname: an IP literal has no records and
  // the query would leak the literal to the resolver.
  if (!isIpLiteral(host)) {
    try {
      const records = await dns.resolveSrv(`_minecraft._tcp.${host}`);
      const best = [...records].sort((a, b) => a.priority - b.priority)[0];
      if (best) return { host: best.name, port: best.port };
    } catch {
      /* no SRV record; fall through */
    }
  }
  return { host, port: MINECRAFT_DEFAULT_PORT };
};

const slpHandshake = (host: string, port: number): Promise<ServerStatus> =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    let buffer = Buffer.alloc(0);

    const finish = (status: ServerStatus): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(status);
    };

    socket.setTimeout(SERVER_PING_TIMEOUT_MS, () => finish(OFFLINE));
    socket.on('error', () => finish(OFFLINE));
    socket.on('close', () => finish(OFFLINE));

    socket.on('connect', () => {
      socket.write(buildHandshakeFrame(host, port));
      socket.write(buildStatusRequestFrame());
    });

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = tryParseStatusResponse(buffer);
      if (parsed === 'incomplete') return;
      finish(parsed ?? OFFLINE);
    });
  });

const pingServer = async (address: string): Promise<ServerStatus> => {
  try {
    const resolved = await resolveAddress(address);
    if (!resolved) {
      logger.warn(`status lookup skipped for unparseable address ${address}`);
      return OFFLINE;
    }
    return await slpHandshake(resolved.host, resolved.port);
  } catch (error) {
    logger.warn(`status lookup failed for ${address}`, error);
    return OFFLINE;
  }
};

// Results stay index-paired with `addresses`: Promise.all preserves input order,
// and the renderer reads statuses by index. A null entry is an address the IPC
// boundary already rejected — it reports offline without consuming a dial slot.
export const getServerStatuses = async (
  addresses: readonly (string | null)[],
): Promise<ServerStatus[]> => {
  if (addresses.length === 0) return [];
  const limit = createLimiter(PING_CONCURRENCY);
  return Promise.all(
    addresses.map((address) => (address === null ? OFFLINE : limit(() => pingServer(address)))),
  );
};
