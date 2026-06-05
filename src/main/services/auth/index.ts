import type { MinecraftKit } from '@loontail/minecraft-kit';
import { runAuthStoreMigrationIfNeeded } from '@main/infra/store';
import type { Router } from '@main/ipc/router';
import { createMojangAuth } from './mojangAuth';
import { registerAuthRoutes } from './routes';
import { type AuthSessionPort, createAuthSessionPort } from './session';
import { createYggdrasilAuth } from './yggdrasilAuth';
import type { YggdrasilGateway } from './yggdrasilClient';

export type AuthService = {
  session: AuthSessionPort;
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createAuthService = (
  router: Router,
  kit: MinecraftKit,
  gateway: YggdrasilGateway,
): AuthService => {
  const yggdrasilAuth = createYggdrasilAuth(gateway.client);
  const mojangAuth = createMojangAuth(kit);
  const session = createAuthSessionPort();
  return {
    session,
    init: async () => {
      runAuthStoreMigrationIfNeeded();
      registerAuthRoutes(router, yggdrasilAuth, mojangAuth, gateway.fetchTextures);
    },
    // No subscriptions or timers to release.
    dispose: () => Promise.resolve(),
  };
};
