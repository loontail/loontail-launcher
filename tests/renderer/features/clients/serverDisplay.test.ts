import { resolveServerDisplayEntry } from '@renderer/features/clients/components/serverDisplay';
import type { ServerStatus } from '@shared/contracts/serverStatus';
import type { Server } from '@shared/contracts/strapi';
import { describe, expect, it } from 'vitest';

const server = (overrides: Partial<Server> = {}): Server =>
  ({ address: 'play.example.com', ...overrides }) as Server;

const status = (overrides: Partial<ServerStatus> = {}): ServerStatus => ({
  online: true,
  ...overrides,
});

describe('resolveServerDisplayEntry', () => {
  it('prefers the configured server name', () => {
    const entry = resolveServerDisplayEntry(
      server({ name: 'My Server' }),
      status({ motd: { clean: ['MOTD Line'] } }),
    );
    expect(entry.displayName).toBe('My Server');
  });

  it('falls back to the first MOTD line when no name is set', () => {
    const entry = resolveServerDisplayEntry(server(), status({ motd: { clean: ['MOTD Line'] } }));
    expect(entry.displayName).toBe('MOTD Line');
  });

  it('falls back to the address when neither name nor MOTD is available', () => {
    const entry = resolveServerDisplayEntry(server(), status());
    expect(entry.displayName).toBe('play.example.com');
  });

  it('exposes players only when online with a player count', () => {
    expect(
      resolveServerDisplayEntry(server(), status({ players: { online: 3, max: 20 } })).players,
    ).toEqual({ online: 3, max: 20 });
    expect(
      resolveServerDisplayEntry(
        server(),
        status({ online: false, players: { online: 3, max: 20 } }),
      ).players,
    ).toBeNull();
    expect(resolveServerDisplayEntry(server(), status()).players).toBeNull();
  });

  it('mirrors the online flag', () => {
    expect(resolveServerDisplayEntry(server(), status({ online: false })).online).toBe(false);
    expect(resolveServerDisplayEntry(server(), status({ online: true })).online).toBe(true);
  });
});
