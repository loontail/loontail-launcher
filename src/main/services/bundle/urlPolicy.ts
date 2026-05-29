import { BundleErrorCodes } from '@shared/contracts/bundle';
import { BundleError } from './errors';

const HTTPS_PROTOCOL = 'https:';
const HTTP_PROTOCOL = 'http:';
const HTTP_DEVELOPMENT_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
const HTTP_DEVELOPMENT_SUFFIXES = ['.localhost', '.test', '.invalid'] as const;

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

const assertAllowedBundleAssetUrl = (
  url: URL,
  code: BundleUrlErrorCode,
  safeLabel: string,
): void => {
  if (url.protocol === HTTPS_PROTOCOL) return;
  if (url.protocol === HTTP_PROTOCOL && isHttpDevelopmentHost(url.hostname)) return;
  if (url.protocol === HTTP_PROTOCOL) {
    throw new BundleError(code, `${safeLabel} uses HTTP outside local/test hosts`);
  }
  throw new BundleError(code, `${safeLabel} uses an unsupported URL scheme`);
};

const describeOrigin = (url: URL): string => `${url.protocol}//${url.host}`;

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

  assertAllowedBundleAssetUrl(next, BundleErrorCodes.DOWNLOAD_FAILED, 'Bundle asset redirect');

  if (next.origin !== initial.origin) {
    throw new BundleError(
      BundleErrorCodes.DOWNLOAD_FAILED,
      `Bundle asset redirect changed origin from ${describeOrigin(initial)} to ${describeOrigin(next)}`,
    );
  }

  return next.toString();
};
