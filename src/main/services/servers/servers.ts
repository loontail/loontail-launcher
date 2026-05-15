import { promises as dns } from 'node:dns';
import net from 'node:net';
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

const logger = scopedLogger('servers');

const resolveAddress = async (address: string): Promise<{ host: string; port: number }> => {
  const [hostPart, portPart] = address.split(':');
  if (!hostPart) return { host: address, port: MINECRAFT_DEFAULT_PORT };
  if (portPart) {
    const parsed = Number(portPart);
    return { host: hostPart, port: Number.isFinite(parsed) ? parsed : MINECRAFT_DEFAULT_PORT };
  }
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${hostPart}`);
    if (records.length > 0) {
      const best = [...records].sort((a, b) => a.priority - b.priority)[0];
      if (best) return { host: best.name, port: best.port };
    }
  } catch {
    /* no SRV record; fall through */
  }
  return { host: hostPart, port: MINECRAFT_DEFAULT_PORT };
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
    const { host, port } = await resolveAddress(address);
    return await slpHandshake(host, port);
  } catch (error) {
    logger.warn(`status lookup failed for ${address}`, error);
    return OFFLINE;
  }
};

export const getServerStatuses = async (addresses: string[]): Promise<ServerStatus[]> => {
  if (!Array.isArray(addresses) || addresses.length === 0) return [];
  return Promise.all(addresses.map(pingServer));
};
