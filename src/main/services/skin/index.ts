import type { MinecraftKit } from '@loontail/minecraft-kit';
import type { Router } from '@main/ipc/router';
import { registerSkinRoutes } from './routes';
import { createSkinHandlers } from './skin';

export type SkinService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createSkinService = (router: Router, kit: MinecraftKit): SkinService => {
  const handlers = createSkinHandlers(kit);
  return {
    init: async () => {
      registerSkinRoutes(router, handlers);
    },
    dispose: async () => {},
  };
};
