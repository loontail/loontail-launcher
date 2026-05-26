import type { MinecraftKit } from '@loontail/minecraft-kit';
import type { Router } from '@main/ipc/router';
import { createMojangAuth } from './mojangAuth';
import { registerAuthRoutes } from './routes';
import { createYggdrasilAuth } from './yggdrasilAuth';
import { getYggdrasilClient } from './yggdrasilClient';

export type AuthService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createAuthService = (router: Router, kit: MinecraftKit): AuthService => {
  const yggdrasilAuth = createYggdrasilAuth(getYggdrasilClient());
  const mojangAuth = createMojangAuth(kit);
  return {
    init: async () => {
      registerAuthRoutes(router, yggdrasilAuth, mojangAuth);
    },
    dispose: async () => {},
  };
};
