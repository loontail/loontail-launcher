import { buildMediaUrl, httpRequest } from '@main/infra/http';
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
  asBundleSlug,
  asClientId,
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

// Strapi rich-text descriptions may arrive as string, null, or a blocks structure.
// The renderer ultimately feeds `description` to `marked.parse`, so anything non-string
// is collapsed to '' here — preserving the previous behavior of `description ?? ''`.
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

const normalizeClient = (client: ClientResponse): Client => {
  const titleImage = client.titleImage ? absolutizeMedia(client.titleImage) : undefined;
  return {
    ...client,
    id: asClientId(client.id),
    bundleSlug: client.bundleSlug ? asBundleSlug(client.bundleSlug) : null,
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

export const fetchClients = async (locale?: string): Promise<StrapiList<Client>> => {
  const response = await httpRequest(API_ROUTES.clients.list(locale ? { locale } : {}));
  if (!response.ok) {
    logger.warn(`clients.list failed with status ${response.status}`);
    throw new Error(`Failed to fetch clients (${response.status})`);
  }
  const raw: unknown = await response.json();
  const parsed = ClientListResponseSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn(
      `clients.list response did not match schema: ${JSON.stringify(parsed.error.format())}`,
    );
    throw new Error('Clients response shape is invalid');
  }
  return {
    ...parsed.data,
    data: parsed.data.data.map(normalizeClient),
  };
};
