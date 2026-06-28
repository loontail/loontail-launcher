import { mainConfig } from '@main/config';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { BundleError } from './errors';

const HTTPS_PROTOCOL = 'https:';
const HTTP_PROTOCOL = 'http:';
const HTTP_DEVELOPMENT_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
const HTTP_DEVELOPMENT_SUFFIXES = ['.localhost', '.test', '.invalid'] as const;

// Bundle assets are served by the same backend as the rest of the API — there
// is no separate asset CDN in this deployment — so every asset/manifest URL is
// host-pinned to the API origin. This closes the manifest-gated SSRF: a
// compromised/misconfigured manifest can no longer point a file at an arbitrary
// host and have the launcher fetch it with the live API bearer attached.
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

// Allow non-API origins only for local/test hosts (the dev backend runs on
// e.g. http://localhost:1337, and tests use .test/.invalid hosts), mirroring the
// existing HTTP-scheme carve-out so dev/test flows keep working.
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

// `pinOrigin` host-pins the initial entry/download URL to the API origin. It is
// false for redirect hops, which `resolveBundleRedirectUrl` already constrains
// to the (already-pinned) initial origin.
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
  // The bearer is attached to these requests, so a non-API host is a
  // bearer-exfil / SSRF target and must be rejected even over HTTPS.
  if (pinOrigin && !isAllowedAssetOrigin(url)) {
    throw new BundleError(code, `${safeLabel} host is not the API origin`);
  }
};

const describeOrigin = (url: URL): string => `${url.protocol}//${url.host}`;

// Whether the live API bearer may ride along with a request to this URL. Only
// the API origin (with the local/test carve-out) is trusted; the downloader uses
// this so a redirect that somehow reached an off-origin host would not leak the
// bearer (defense-in-depth on top of the entry host-pin + redirect origin lock).
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
