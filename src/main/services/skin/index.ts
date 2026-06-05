import type { MinecraftKit } from '@loontail/minecraft-kit';
import type { Router } from '@main/ipc/router';
import type { AuthSessionPort } from '@main/services/auth/session';
import type { YggdrasilGateway } from '@main/services/auth/yggdrasilClient';
import { registerSkinRoutes } from './routes';
import { createSkinHandlers } from './skin';

export type SkinService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createSkinService = (
  router: Router,
  kit: MinecraftKit,
  gateway: YggdrasilGateway,
  authSession: AuthSessionPort,
): SkinService => {
  const handlers = createSkinHandlers(kit, gateway, authSession);
  return {
    init: async () => {
      registerSkinRoutes(router, handlers);
    },
    // No subscriptions or timers to release.
    dispose: () => Promise.resolve(),
  };
};
