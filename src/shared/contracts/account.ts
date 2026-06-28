import type { AuthProvider, AuthSession } from './auth';

// Provider-agnostic view of the signed-in user; rich provider data lives behind
// `AuthSession`. For Yggdrasil, `email`/`skin`/`cape` are enriched elsewhere —
// `accountFromSession` alone returns them as null.
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
