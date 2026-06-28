import type { MinecraftProfile } from '@loontail/minecraft-kit';
import { getStoredAuth, getStoredSessionToken, setStoredAuth } from '@main/infra/store';
import type { AuthSession, MojangSession } from '@shared/contracts/auth';

// The caller passes the already-returned profile in to avoid a second GET.
export const withRefreshedProfile = (
  session: MojangSession,
  profile: MinecraftProfile,
): MojangSession => ({
  ...session,
  profile: {
    uuid: profile.uuid,
    username: profile.username,
    skins: [...profile.skins],
  },
});

// The auth service is the single owner of stored-session reads and writes;
// sibling services go through this port so session invariants live in one place.
export type AuthSessionPort = {
  current: () => AuthSession | null;
  // The universal API bearer, or null when no session is stored. Distinct from a
  // Yggdrasil session's in-game `accessToken`, which only feeds the
  // authlib-injector handshake; the unified API authenticates with this token.
  sessionToken: () => string | null;
  updateMojangProfile: (session: MojangSession, profile: MinecraftProfile) => MojangSession;
};

export const createAuthSessionPort = (): AuthSessionPort => ({
  current: () => getStoredAuth(),
  sessionToken: () => getStoredSessionToken(),
  updateMojangProfile: (session, profile) => {
    const refreshed = withRefreshedProfile(session, profile);
    setStoredAuth(refreshed);
    return refreshed;
  },
});
