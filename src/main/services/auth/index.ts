import type { MinecraftKit } from '@loontail/minecraft-kit';
import { registerSessionAuthPort } from '@main/infra/http';
import { getStoredSessionToken, runAuthStoreMigrationIfNeeded } from '@main/infra/store';
import type { Router } from '@main/ipc/router';
import { createAuthApi } from './authApi';
import { createLoontailAuth } from './loontailAuth';
import { createMojangAuth } from './mojangAuth';
import { registerAuthRoutes } from './routes';
import { type AuthSessionPort, createAuthSessionPort } from './session';
import { type SessionRefresher, createSessionRefresher } from './sessionRefresh';
import type { YggdrasilGateway } from './yggdrasilClient';

export type AuthService = {
  session: AuthSessionPort;
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

// Bridge the HTTP layer's session-auth needs (attach bearer, refresh-and-retry)
// to the stored session + the shared refresher. The refresher de-duplicates the
// rotation and persists the new session in place; the port just hands the HTTP
// layer the rotated bearer (or null when the session is gone) for its retry.
const buildSessionAuthPort = (refresher: SessionRefresher) => ({
  getToken: (): string | null => getStoredSessionToken(),
  refresh: async (): Promise<string | null> => {
    const result = await refresher.refresh();
    return result.kind === 'ok' ? result.identity.sessionToken : null;
  },
});

export const createAuthService = (
  router: Router,
  kit: MinecraftKit,
  gateway: YggdrasilGateway,
): AuthService => {
  const loontailAuth = createLoontailAuth(createAuthApi());
  const mojangAuth = createMojangAuth(kit);
  const session = createAuthSessionPort();
  // One refresher instance shared by the HTTP refresh-and-retry path and
  // verifySession so a single-use token is never rotated twice concurrently.
  const refresher = createSessionRefresher(loontailAuth);
  return {
    session,
    init: async () => {
      runAuthStoreMigrationIfNeeded();
      registerSessionAuthPort(buildSessionAuthPort(refresher));
      registerAuthRoutes(router, loontailAuth, mojangAuth, gateway.fetchTextures, refresher);
    },
    // No subscriptions or timers to release.
    dispose: () => Promise.resolve(),
  };
};
