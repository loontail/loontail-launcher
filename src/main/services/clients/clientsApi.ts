import { buildMediaUrl, httpGet } from '@main/infra/http';
import { scopedLogger } from '@main/infra/logger';
import { API_ROUTES } from '@shared/constants';
import {
  type BundleSlug,
  type Client,
  ClientListResponseSchema,
  type ClientResponse,
  type Media,
  asBundleSlug,
  asClientId,
  asClientSlug,
} from '@shared/contracts';

const logger = scopedLogger('clients');

const coerceVersionString = (input: unknown): string | null => {
  if (typeof input === 'string') return input;
  if (input === null || input === undefined) return null;
  if (typeof input === 'object') {
    const candidate = (input as { version?: unknown }).version;
    return typeof candidate === 'string' ? candidate : null;
  }
  return null;
};

// Rich-text fields may be string or null; collapse anything non-string to ''
// (renderer feeds this to marked.parse).
const coerceDescriptionString = (input: unknown): string =>
  typeof input === 'string' ? input : '';

const absolutizeMedia = (media: Media): Media => ({
  ...media,
  url: buildMediaUrl(media.url),
});

// The API may return an empty string for an unset bundleSlug; collapse it (and
// other empty/falsy forms) to null so the manager treats it uniformly.
const coerceBundleSlug = (input: unknown): BundleSlug | null => {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? asBundleSlug(trimmed) : null;
};

const normalizeClient = (client: ClientResponse): Client | null => {
  if (!client.slug) {
    // No slug — launcher cannot identify (settings key, folder, IPC). Drop.
    logger.warn(`Client id=${client.id} has no slug; skipping`);
    return null;
  }
  return {
    ...client,
    id: asClientId(client.id),
    slug: asClientSlug(client.slug),
    description: coerceDescriptionString(client.description),
    shortDescription: coerceDescriptionString(client.shortDescription),
    minecraftVersion: coerceVersionString(client.minecraftVersion) ?? '',
    forgeVersion: coerceVersionString(client.forgeVersion),
    fabricVersion: coerceVersionString(client.fabricVersion),
    runtimeVersion: coerceVersionString(client.runtimeVersion),
    bundleSlug: coerceBundleSlug(client.bundleSlug),
    background: client.background ? absolutizeMedia(client.background) : null,
    poster: client.poster ? absolutizeMedia(client.poster) : null,
    titleImage: client.titleImage ? absolutizeMedia(client.titleImage) : null,
    screenshots: (client.screenshots ?? []).map((media) => absolutizeMedia(media)),
  };
};

export type FetchClientsOptions = {
  locale?: string;
  signal?: AbortSignal;
};

export const fetchClients = async (options: FetchClientsOptions = {}): Promise<Client[]> => {
  const { locale, signal } = options;
  const parsed = await httpGet(
    API_ROUTES.clients.list(locale ? { locale } : {}),
    ClientListResponseSchema,
    {
      auth: 'session',
      ...(signal ? { signal } : {}),
    },
  );
  return parsed.clients.map(normalizeClient).filter((c): c is Client => c !== null);
};
