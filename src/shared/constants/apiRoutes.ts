import type { SkinKind } from '@shared/contracts/skin';

export const API_ROUTES = {
  auth: {
    login: () => '/auth/local',
    me: () => '/users/me',
  },
  users: {
    byId: (userId: number) => `/users/${userId}`,
  },
  skinsRegistry: {
    upload: (type: SkinKind, userId: number) => `/skins-registry/${type}/${userId}`,
    forPlayer: (userId: number) => `/skins-registry/player/${userId}`,
    byKind: (type: SkinKind, userId: number) => `/skins-registry/${type}/${userId}`,
  },
} as const;
