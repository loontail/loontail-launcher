import type { MinecraftProfile } from '@loontail/minecraft-kit';
import { getStoredAuth, getStoredSessionToken, setStoredAuth } from '@main/infra/store';
import type { AuthSession, MojangSession } from '@shared/contracts/auth';

// Mojang profile.* mutations already return the updated profile, so the caller
// passes it in instead of triggering another GET.
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

// The auth service is the single owner of stored-session reads and writes.
// Sibling services (skin) go through this port instead of touching the store
// or auth internals directly, so session invariants live in one place and the
// storage layer can evolve without breaking unrelated services.
export type AuthSessionPort = {
  current: () => AuthSession | null;
  // The universal Loontail API bearer (the session token persisted alongside the
  // session), or null when no session is stored. Distinct from a Yggdrasil
  // session's in-game `accessToken`, which only feeds the authlib-injector
  // handshake — the unified API (catalog, bundles, textures) authenticates with
  // this token.
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
