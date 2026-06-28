import type { AuthProvider, AuthSession } from './auth';

// Provider-agnostic view of the currently signed-in user. The renderer and
// the launch path consume this; the rich provider-specific data lives behind
// `AuthSession`.
//
// For Yggdrasil sessions, `email` comes from the login response and `skin`/`cape`
// are enriched from the textures endpoint; the `accountFromSession` helper alone
// returns them as `null`.
export type Account = {
  provider: AuthProvider;
  username: string;
  email: string | null;
  skin: string | null;
  cape: string | null;
};

export const accountFromSession = (session: AuthSession): Account => {
  if (session.provider === 'yggdrasil') {
    return {
      provider: 'yggdrasil',
      username: session.profile.name,
      email: null,
      skin: null,
      cape: null,
    };
  }
  const activeSkin = session.profile.skins.find((s) => s.state === 'ACTIVE');
  return {
    provider: 'mojang',
    username: session.profile.username,
    email: null,
    skin: activeSkin?.url ?? null,
    cape: null,
  };
};
