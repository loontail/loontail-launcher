import type { Server } from '@shared/contracts/media';
import type { ServerStatus } from '@shared/contracts/serverStatus';

export type ServerDisplayEntry = {
  displayName: string;
  online: boolean;
  players: { online: number; max: number } | null;
};

export const resolveServerDisplayEntry = (
  server: Server,
  status: ServerStatus,
): ServerDisplayEntry => ({
  displayName: server.name ?? status.motd?.clean[0] ?? server.address,
  online: status.online,
  players: status.online && status.players ? status.players : null,
});
