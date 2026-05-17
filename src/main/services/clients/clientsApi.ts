import { buildMediaUrl, httpGet } from '@main/infra/http';
import { scopedLogger } from '@main/infra/logger';
import { API_ROUTES } from '@shared/constants';
import {
  type Client,
  type ClientResponse,
  ClientResponseSchema,
  type StrapiImageFormat,
  type StrapiList,
  StrapiListSchema,
  type StrapiMedia,
  asClientId,
  asClientSlug,
} from '@shared/contracts';

const logger = scopedLogger('clients');

const ClientListResponseSchema = StrapiListSchema(ClientResponseSchema);

const coerceVersionString = (input: unknown): string | null => {
  if (typeof input === 'string') return input;
  if (input === null || input === undefined) return null;
  if (typeof input === 'object') {
    const candidate = (input as { version?: unknown }).version;
    return typeof candidate === 'string' ? candidate : null;
  }
  return null;
};

// Strapi rich-text fields may be string, null, or a blocks structure; collapse
// anything non-string to '' (renderer feeds this to marked.parse).
const coerceDescriptionString = (input: unknown): string =>
  typeof input === 'string' ? input : '';

const absolutizeFormat = (format: StrapiImageFormat): StrapiImageFormat => ({
  ...format,
  url: buildMediaUrl(format.url),
});

const absolutizeFormats = (formats: StrapiMedia['formats']): StrapiMedia['formats'] => ({
  ...(formats?.thumbnail ? { thumbnail: absolutizeFormat(formats.thumbnail) } : {}),
  ...(formats?.small ? { small: absolutizeFormat(formats.small) } : {}),
  ...(formats?.medium ? { medium: absolutizeFormat(formats.medium) } : {}),
  ...(formats?.large ? { large: absolutizeFormat(formats.large) } : {}),
});

const absolutizeMedia = (media: StrapiMedia): StrapiMedia => ({
  ...media,
  url: buildMediaUrl(media.url),
  formats: absolutizeFormats(media.formats),
});

const normalizeClient = (client: ClientResponse): Client | null => {
  if (!client.slug) {
    // No slug — launcher cannot identify (settings key, folder, IPC). Drop.
    logger.warn(
      `Strapi client id=${client.id} (documentId=${client.documentId}) has no slug; skipping`,
    );
    return null;
  }
  const titleImage = client.titleImage ? absolutizeMedia(client.titleImage) : undefined;
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
    background: absolutizeMedia(client.background),
    poster: absolutizeMedia(client.poster),
    ...(titleImage ? { titleImage } : {}),
    screenshots: (client.screenshots ?? []).map((media) => absolutizeMedia(media)),
  };
};

export type FetchClientsOptions = {
  locale?: string;
  signal?: AbortSignal;
};

export const fetchClients = async (
  options: FetchClientsOptions = {},
): Promise<StrapiList<Client>> => {
  const { locale, signal } = options;
  const parsed = await httpGet(
    API_ROUTES.clients.list(locale ? { locale } : {}),
    ClientListResponseSchema,
    signal ? { signal } : {},
  );
  const normalized = parsed.data.map(normalizeClient).filter((c): c is Client => c !== null);
  return {
    ...parsed,
    data: normalized,
  };
};
