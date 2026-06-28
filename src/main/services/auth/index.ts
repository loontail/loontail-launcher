import type { MinecraftKit } from '@loontail/minecraft-kit';
import { registerSessionAuthPort } from '@main/infra/http';
import {
  getStoredAuth,
  getStoredSessionToken,
  runAuthStoreMigrationIfNeeded,
  setStoredAuth,
} from '@main/infra/store';
import type { Router } from '@main/ipc/router';
import { createAuthApi } from './authApi';
import { type LoontailAuth, createLoontailAuth } from './loontailAuth';
import { createMojangAuth } from './mojangAuth';
import { registerAuthRoutes } from './routes';
import { type AuthSessionPort, createAuthSessionPort } from './session';
import type { YggdrasilGateway } from './yggdrasilClient';

export type AuthService = {
  session: AuthSessionPort;
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

// Bridge the HTTP layer's session-auth needs (attach bearer, refresh-and-retry)
// to the stored session + the Loontail auth API. A refresh rotates the stored
// session in place and hands the HTTP layer the new bearer for its retry.
const buildSessionAuthPort = (loontailAuth: LoontailAuth) => ({
  getToken: (): string | null => getStoredSessionToken(),
  refresh: async (): Promise<string | null> => {
    const session = getStoredAuth();
    const token = getStoredSessionToken();
    if (session?.provider !== 'yggdrasil' || !token) return null;
    const result = await loontailAuth.refresh(token);
    if (result.kind !== 'ok') return null;
    setStoredAuth(result.identity.session, result.identity.sessionToken);
    return result.identity.sessionToken;
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
  return {
    session,
    init: async () => {
      runAuthStoreMigrationIfNeeded();
      registerSessionAuthPort(buildSessionAuthPort(loontailAuth));
      registerAuthRoutes(router, loontailAuth, mojangAuth, gateway.fetchTextures);
    },
    // No subscriptions or timers to release.
    dispose: () => Promise.resolve(),
  };
};
