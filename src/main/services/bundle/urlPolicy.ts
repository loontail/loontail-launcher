import {
  classifyUrl,
  isTransportDowngrade,
  type OriginPolicy,
  type OriginRejection,
  type OriginTrust,
} from '@main/infra/originPolicy';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { BundleError } from './errors';

// Assets share the API origin (no separate CDN), so every asset/manifest URL is
// host-pinned to it. Closes the manifest-gated SSRF: a crafted manifest can't
// point a file at an arbitrary host and have it fetched with the live bearer.
// Local/test hosts stay REACHABLE (dev API deployments, the loopback download
// tests) but classify as `public`, so they never carry the bearer either.
const BUNDLE_ORIGIN_POLICY: OriginPolicy = { allowLocalHosts: true };

const MESSAGE_BY_REASON: Record<OriginRejection, string> = {
  'invalid-url': 'is not a valid URL',
  'unsupported-scheme': 'uses an unsupported URL scheme',
  'insecure-transport': 'uses HTTP outside local/test hosts',
  'untrusted-host': 'host is not the API origin',
};

type BundleUrlErrorCode =
  | typeof BundleErrorCodes.MANIFEST_INVALID
  | typeof BundleErrorCodes.DOWNLOAD_FAILED;

const DOWNLOAD_LABEL = 'Bundle asset download URL';

const absolutize = (url: string, baseUrl: string | undefined): string | null => {
  try {
    return baseUrl ? new URL(url, baseUrl).toString() : url;
  } catch {
    return null;
  }
};

const requireAllowedUrl = (
  url: string,
  baseUrl: string | undefined,
  code: BundleUrlErrorCode,
  safeLabel: string,
): URL => {
  const absolute = absolutize(url, baseUrl);
  const verdict =
    absolute === null
      ? ({ trust: null, reason: 'invalid-url' } as const)
      : classifyUrl(absolute, BUNDLE_ORIGIN_POLICY);
  if (verdict.trust === null) {
    throw new BundleError(code, `${safeLabel} ${MESSAGE_BY_REASON[verdict.reason]}`);
  }
  return verdict.url;
};

const describeOrigin = (url: URL): string => `${url.protocol}//${url.host}`;

// Gates the bearer at download.ts: only `'api'` carries it, so a crafted manifest
// entry pointing at a local/test host downloads without a credential instead of
// leaking one.
export const bundleAssetTrust = (url: string): OriginTrust | null =>
  classifyUrl(url, BUNDLE_ORIGIN_POLICY).trust;

export const resolveBundleManifestEntryUrl = (
  url: string,
  baseUrl: string,
  entryPath: string,
): string =>
  requireAllowedUrl(
    url,
    baseUrl,
    BundleErrorCodes.MANIFEST_INVALID,
    `Bundle manifest entry ${entryPath}`,
  ).toString();

export const validateBundleAssetDownloadUrl = (url: string): string =>
  requireAllowedUrl(url, undefined, BundleErrorCodes.DOWNLOAD_FAILED, DOWNLOAD_LABEL).toString();

export const resolveBundleRedirectUrl = (
  location: string,
  currentUrl: string,
  initialUrl: string,
): string => {
  const current = requireAllowedUrl(
    currentUrl,
    undefined,
    BundleErrorCodes.DOWNLOAD_FAILED,
    DOWNLOAD_LABEL,
  );
  const initial = requireAllowedUrl(
    initialUrl,
    undefined,
    BundleErrorCodes.DOWNLOAD_FAILED,
    DOWNLOAD_LABEL,
  );
  const nextRaw = absolutize(location, current.toString());
  if (nextRaw === null) {
    throw new BundleError(
      BundleErrorCodes.DOWNLOAD_FAILED,
      `Bundle asset redirect ${MESSAGE_BY_REASON['invalid-url']}`,
    );
  }
  // Checked before classification: a local/test hop classifies as `public`, so
  // without this a downgrade inside the dev carve-out would pass silently.
  if (isTransportDowngrade(current, new URL(nextRaw))) {
    throw new BundleError(
      BundleErrorCodes.DOWNLOAD_FAILED,
      'Bundle asset redirect downgraded from HTTPS to HTTP',
    );
  }
  const next = requireAllowedUrl(
    nextRaw,
    undefined,
    BundleErrorCodes.DOWNLOAD_FAILED,
    'Bundle asset redirect',
  );
  if (next.origin !== initial.origin) {
    throw new BundleError(
      BundleErrorCodes.DOWNLOAD_FAILED,
      `Bundle asset redirect changed origin from ${describeOrigin(initial)} to ${describeOrigin(next)}`,
    );
  }
  return next.toString();
};
