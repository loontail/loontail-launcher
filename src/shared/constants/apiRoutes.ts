import type { BundleSlug } from '@shared/contracts/ids';

export const API_PATH_PREFIX = '/api';

export const API_ROUTES = {
  clients: {
    list: (params: { locale?: string } = {}) =>
      params.locale ? `/clients?locale=${params.locale}` : '/clients',
  },
  bundleRegistry: {
    // `httpRequest` prepends the shared `/api` prefix, so we omit it here.
    manifest: (slug: BundleSlug) => `/bundle-registry/builds/${slug}/manifest`,
  },
} as const;
