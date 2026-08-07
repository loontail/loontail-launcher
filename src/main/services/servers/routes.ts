import { scopedLogger } from '@main/infra/logger';
import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { IPC_CHANNELS } from '@shared/ipc';
import { z } from 'zod';
import { getServerStatuses } from './servers';

// The renderer passes a build's server list straight through, so the payload is
// bounded here: an arbitrary-length list is an internal port-scan / DNS-exfil
// primitive once a renderer is compromised.
const SERVERS_MAX_ADDRESSES = 32;
const MAX_ADDRESS_LENGTH = 255;

const AddressesSchema = z.array(z.unknown()).max(SERVERS_MAX_ADDRESSES);

// Characters that cannot occur in a host[:port]: they mean the entry is a URL, a
// path, or credentials, and forwarding it would turn a resolver query into an
// exfil channel. The host grammar itself is validated per address by
// servers.ts/parseAddress, which answers OFFLINE for whatever it cannot parse.
const NON_ADDRESS_CHARS = /[\s/\\?#@%]/;

const logger = scopedLogger('servers.routes');

// `Server.address` is free text end-to-end (the backend column is a plain String
// and the shared contract is `z.string()`), so an admin can save a trailing space
// or a full URL. Sanitise per element and null out what cannot be used: rejecting
// the batch would drop the status of every well-formed server in the build.
const sanitizeAddress = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ADDRESS_LENGTH) return null;
  if (NON_ADDRESS_CHARS.test(trimmed)) return null;
  return trimmed;
};

// MAX_ADDRESS_LENGTH only decides whether an entry becomes null; it never bounds
// what is logged. Launcher logs get attached to bug reports, so the rejected
// values — 32 arbitrary-size strings or objects per call, repeatable — are
// projected to a short, typed preview before they reach the log file.
const LOG_PREVIEW_LENGTH = 80;

const describeSkipped = (value: unknown): string =>
  typeof value === 'string' ? value.slice(0, LOG_PREVIEW_LENGTH) : typeof value;

export const registerServersRoutes = (router: Router): void => {
  router.handle(IPC_CHANNELS.serversGetStatuses, (args) => {
    const raw = parseIpcArgs(AddressesSchema, args, 'Invalid addresses payload');
    const addresses = raw.map(sanitizeAddress);
    const skipped = raw
      .filter((_value, index) => addresses[index] === null)
      .map((value) => describeSkipped(value));
    if (skipped.length > 0) {
      logger.warn('Reporting unusable server addresses as offline', { skipped });
    }
    return getServerStatuses(addresses);
  });
};
