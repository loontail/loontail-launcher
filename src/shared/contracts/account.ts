import type { AuthProvider, AuthSession } from './auth';

// Provider-agnostic view of the currently signed-in user. The renderer and
// the launch path consume this; the rich provider-specific data lives behind
// `AuthSession`. Strapi-only fields (`email`) are `null` for Mojang sessions.
export type Account = {
  provider: AuthProvider;
  username: string;
  email: string | null;
  skin: string | null;
  cape: string | null;
};

export const accountFromSession = (session: AuthSession): Account => {
  if (session.provider === 'strapi') {
    return {
      provider: 'strapi',
      username: session.user.username,
      email: session.user.email,
      skin: session.user.skin ?? null,
      cape: session.user.cape ?? null,
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
