import type { SkinKind } from '@shared/contracts/skin';

export const API_PATH_PREFIX = '/api';

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
  },
  clients: {
    list: (params: { locale?: string } = {}) => {
      const populate = [
        'populate[screenshots]=true',
        'populate[background]=true',
        'populate[poster]=true',
        'populate[titleImage]=true',
        'populate[keywords]=true',
        'populate[servers]=true',
      ].join('&');
      const localeParam = params.locale ? `&locale=${params.locale}` : '';
      return `/clients?${populate}${localeParam}`;
    },
  },
  bundleRegistry: {
    // Plugin route is content-api scoped; `httpRequest` prepends the shared
    // `/api` prefix, so we omit it here.
    manifest: (slug: string) => `/bundle-registry/builds/${slug}/manifest`,
  },
} as const;
