import { mainConfig } from '@main/config';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { BundleError } from './errors';

const HTTPS_PROTOCOL = 'https:';
const HTTP_PROTOCOL = 'http:';
const HTTP_DEVELOPMENT_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
const HTTP_DEVELOPMENT_SUFFIXES = ['.localhost', '.test', '.invalid'] as const;

// Assets share the API origin (no separate CDN), so every asset/manifest URL is
// host-pinned to it. Closes the manifest-gated SSRF: a crafted manifest can't
// point a file at an arbitrary host and have it fetched with the live bearer.
const API_ORIGIN = new URL(mainConfig.apiUrl).origin;

type BundleUrlErrorCode =
  | typeof BundleErrorCodes.MANIFEST_INVALID
  | typeof BundleErrorCodes.DOWNLOAD_FAILED;

const normalizeHostname = (hostname: string): string =>
  hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');

const isHttpDevelopmentHost = (hostname: string): boolean => {
  const normalized = normalizeHostname(hostname);
  return (
    HTTP_DEVELOPMENT_HOSTS.has(normalized) ||
    HTTP_DEVELOPMENT_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
};

// Allow non-API origins only for local/test hosts so dev/test flows keep
// working, mirroring the HTTP-scheme carve-out.
const isAllowedAssetOrigin = (url: URL): boolean =>
  url.origin === API_ORIGIN || isHttpDevelopmentHost(url.hostname);

const parseBundleAssetUrl = (
  url: string,
  baseUrl: string | undefined,
  code: BundleUrlErrorCode,
  safeLabel: string,
): URL => {
  try {
    return baseUrl ? new URL(url, baseUrl) : new URL(url);
  } catch {
    throw new BundleError(code, `${safeLabel} is not a valid URL`);
  }
};

// `pinOrigin` host-pins the initial entry/download URL; false for redirect hops,
// which resolveBundleRedirectUrl already constrains to the initial origin.
const assertAllowedBundleAssetUrl = (
  url: URL,
  code: BundleUrlErrorCode,
  safeLabel: string,
  pinOrigin = true,
): void => {
  if (url.protocol !== HTTPS_PROTOCOL && url.protocol !== HTTP_PROTOCOL) {
    throw new BundleError(code, `${safeLabel} uses an unsupported URL scheme`);
  }
  if (url.protocol === HTTP_PROTOCOL && !isHttpDevelopmentHost(url.hostname)) {
    throw new BundleError(code, `${safeLabel} uses HTTP outside local/test hosts`);
  }
  // The bearer rides these requests, so a non-API host is a bearer-exfil/SSRF
  // target and is rejected even over HTTPS.
  if (pinOrigin && !isAllowedAssetOrigin(url)) {
    throw new BundleError(code, `${safeLabel} host is not the API origin`);
  }
};

const describeOrigin = (url: URL): string => `${url.protocol}//${url.host}`;

// Whether the bearer may ride a request to this URL: only the API origin (with
// the local/test carve-out) is trusted, so an off-origin redirect can't leak it.
export const isTrustedBundleAssetUrl = (url: string): boolean => {
  try {
    return isAllowedAssetOrigin(new URL(url));
  } catch {
    return false;
  }
};

export const resolveBundleManifestEntryUrl = (
  url: string,
  baseUrl: string,
  entryPath: string,
): string => {
  const safeLabel = `Bundle manifest entry ${entryPath}`;
  const parsed = parseBundleAssetUrl(url, baseUrl, BundleErrorCodes.MANIFEST_INVALID, safeLabel);
  assertAllowedBundleAssetUrl(parsed, BundleErrorCodes.MANIFEST_INVALID, safeLabel);
  return parsed.toString();
};

export const validateBundleAssetDownloadUrl = (url: string): string => {
  const parsed = parseBundleAssetUrl(
    url,
    undefined,
    BundleErrorCodes.DOWNLOAD_FAILED,
    'Bundle asset download URL',
  );
  assertAllowedBundleAssetUrl(
    parsed,
    BundleErrorCodes.DOWNLOAD_FAILED,
    'Bundle asset download URL',
  );
  return parsed.toString();
};

export const resolveBundleRedirectUrl = (
  location: string,
  currentUrl: string,
  initialUrl: string,
): string => {
  const current = parseBundleAssetUrl(
    currentUrl,
    undefined,
    BundleErrorCodes.DOWNLOAD_FAILED,
    'Bundle asset download URL',
  );
  const initial = parseBundleAssetUrl(
    initialUrl,
    undefined,
    BundleErrorCodes.DOWNLOAD_FAILED,
    'Bundle asset download URL',
  );
  const next = parseBundleAssetUrl(
    location,
    current.toString(),
    BundleErrorCodes.DOWNLOAD_FAILED,
    'Bundle asset redirect',
  );

  if (current.protocol === HTTPS_PROTOCOL && next.protocol === HTTP_PROTOCOL) {
    throw new BundleError(
      BundleErrorCodes.DOWNLOAD_FAILED,
      'Bundle asset redirect downgraded from HTTPS to HTTP',
    );
  }

  assertAllowedBundleAssetUrl(
    next,
    BundleErrorCodes.DOWNLOAD_FAILED,
    'Bundle asset redirect',
    false,
  );

  if (next.origin !== initial.origin) {
    throw new BundleError(
      BundleErrorCodes.DOWNLOAD_FAILED,
      `Bundle asset redirect changed origin from ${describeOrigin(initial)} to ${describeOrigin(next)}`,
    );
  }

  return next.toString();
};
