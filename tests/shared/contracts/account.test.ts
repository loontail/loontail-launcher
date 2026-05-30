import { accountFromSession } from '@shared/contracts/account';
import type { MojangSession, YggdrasilSession } from '@shared/contracts/auth';
import { describe, expect, it } from 'vitest';

const yggdrasilSession = (): YggdrasilSession => ({
  provider: 'yggdrasil',
  accessToken: 'access',
  clientToken: 'client',
  profile: { uuid: '0123456789abcdef0123456789abcdef', name: 'someone' },
});

// accountFromSession only reads profile.username and profile.skins for a Mojang
// session, so a plain literal cast keeps the branded fields out of the test.
const mojangSession = (skins: MojangSession['profile']['skins']): MojangSession =>
  ({
    provider: 'mojang',
    accessToken: 'access',
    expiresAt: Date.UTC(2099, 0, 1),
    refreshToken: 'refresh',
    clientId: 'client',
    xuid: 'xuid',
    profile: { uuid: 'uuid', username: 'player', skins },
  }) as unknown as MojangSession;

describe('accountFromSession', () => {
  it('maps a Yggdrasil session to a bare account with null skin/cape/email', () => {
    expect(accountFromSession(yggdrasilSession())).toEqual({
      provider: 'yggdrasil',
      username: 'someone',
      email: null,
      skin: null,
      cape: null,
    });
  });

  it('uses the ACTIVE Mojang skin url', () => {
    const account = accountFromSession(
      mojangSession([
        { id: '1', state: 'INACTIVE', url: 'https://skins/old', variant: 'CLASSIC' },
        { id: '2', state: 'ACTIVE', url: 'https://skins/current', variant: 'SLIM' },
      ]),
    );
    expect(account).toEqual({
      provider: 'mojang',
      username: 'player',
      email: null,
      skin: 'https://skins/current',
      cape: null,
    });
  });

  it('returns a null skin when no Mojang skin is ACTIVE', () => {
    const account = accountFromSession(
      mojangSession([{ id: '1', state: 'INACTIVE', url: 'https://skins/old', variant: 'CLASSIC' }]),
    );
    expect(account.skin).toBeNull();
  });
});
