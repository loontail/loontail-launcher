import { createHash } from 'node:crypto';
import { mainConfig } from '@main/config';
import { HttpError, httpRequest } from '@main/infra/http';
import { scopedLogger } from '@main/infra/logger';
import { API_ROUTES } from '@shared/constants';
import { type RemoteManifest, RemoteManifestSchema } from '@shared/contracts/bundle';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { BundleError, errorMessage } from './errors';

const logger = scopedLogger('bundle.api');

export type RemoteManifestFetchResult = {
  manifest: RemoteManifest;
  // SHA-256 of the raw JSON, used as a stable drift signal that survives key
  // re-ordering as long as Strapi serializes consistently (it does — the file
  // is read from disk verbatim).
  manifestHash: string;
};

const sha256 = (input: string): string => createHash('sha256').update(input, 'utf8').digest('hex');

// Strapi's bundle-registry plugin can emit server-root-relative URLs (e.g.
// `/bundle-registry/builds/<slug>/files/<path>`) when the plugin's `publicUrl`
// is unset and `server.url` is empty. Resolve those against the configured
// API base so the downloader can treat every URL as absolute.
const absolutizeUrl = (url: string, baseUrl: string): string => {
  try {
    return new URL(url).toString();
  } catch {
    return new URL(url, baseUrl).toString();
  }
};

const absolutizeManifestUrls = (manifest: RemoteManifest, baseUrl: string): RemoteManifest => {
  const out: RemoteManifest = {};
  for (const [category, entries] of Object.entries(manifest)) {
    out[category] = entries.map((entry) =>
      entry.url ? { ...entry, url: absolutizeUrl(entry.url, baseUrl) } : entry,
    );
  }
  return out;
};

export const fetchRemoteManifest = async (
  slug: string,
  signal?: AbortSignal,
): Promise<RemoteManifestFetchResult> => {
  const path = API_ROUTES.bundleRegistry.manifest(slug);
  let response: Response;
  try {
    response = await httpRequest(path, {
      method: 'GET',
      auth: 'apiToken',
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if (signal?.aborted) {
      throw new BundleError(BundleErrorCodes.ABORTED, 'Bundle manifest fetch aborted');
    }
    logger.warn(`Bundle manifest fetch failed: ${errorMessage(err)}`);
    throw new BundleError(
      BundleErrorCodes.MANIFEST_FETCH_FAILED,
      `Failed to fetch bundle manifest: ${errorMessage(err)}`,
    );
  }
  if (!response.ok) {
    let preview = '';
    try {
      preview = (await response.text()).slice(0, 200);
    } catch {
      /* swallow body read errors — status is enough to throw */
    }
    throw new BundleError(
      BundleErrorCodes.MANIFEST_FETCH_FAILED,
      `Bundle manifest HTTP ${response.status} ${response.statusText}${preview ? ` — ${preview}` : ''}`,
    );
  }
  const rawText = await response.text();
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch (err) {
    throw new BundleError(
      BundleErrorCodes.MANIFEST_INVALID,
      `Bundle manifest is not valid JSON: ${errorMessage(err)}`,
    );
  }
  const validated = RemoteManifestSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new BundleError(
      BundleErrorCodes.MANIFEST_INVALID,
      `Bundle manifest failed schema validation: ${validated.error.message}`,
    );
  }
  return {
    manifest: absolutizeManifestUrls(validated.data, mainConfig.apiUrl),
    manifestHash: sha256(rawText),
  };
};

// Re-export so callers can `instanceof` without importing from infra.
export { HttpError };
