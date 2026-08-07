import { mainConfig } from '@main/config';

// One trust vocabulary for every outbound URL the launcher builds from data it did
// not author: bundle manifest entries, catalog media, Mojang skin textures.
//
//   'api'    — our own origin. The ONLY trust level the session bearer rides.
//   'public' — reachable, never carries the bearer.
//   null     — refused before a socket is opened.
//
// Before this module the same decision lived in three places and two of them
// disagreed about where the bearer may go.
export type OriginTrust = 'api' | 'public';

export type OriginRejection =
  | 'invalid-url'
  | 'unsupported-scheme'
  | 'insecure-transport'
  | 'untrusted-host';

export type OriginVerdict =
  | { readonly trust: OriginTrust; readonly url: URL }
  | { readonly trust: null; readonly reason: OriginRejection };

export type OriginPolicy = {
  // Extra hosts reachable WITHOUT the bearer (exact hostname match, no subdomains).
  readonly publicHosts?: readonly string[];
  // Treat local/test hosts as `public` instead of refusing them. Opt-in per call
  // site: bundle assets need it so dev API deployments and the loopback download
  // tests keep working, media must NOT have it or a crafted `cache://` URL turns
  // the main process into an SSRF probe against 127.0.0.1 / 169.254.169.254.
  readonly allowLocalHosts?: boolean;
};

const HTTPS_PROTOCOL = 'https:';
const HTTP_PROTOCOL = 'http:';

const API_ORIGIN = new URL(mainConfig.apiUrl).origin;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
const LOCAL_SUFFIXES = ['.localhost', '.test', '.invalid'] as const;

const normalizeHostname = (hostname: string): string =>
  hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');

// The only hosts a plaintext HTTP socket may be opened to.
export const isLocalOrTestHost = (hostname: string): boolean => {
  const normalized = normalizeHostname(hostname);
  return (
    LOCAL_HOSTS.has(normalized) || LOCAL_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
};

export const classifyUrl = (url: string | URL, policy: OriginPolicy = {}): OriginVerdict => {
  let parsed: URL;
  try {
    parsed = typeof url === 'string' ? new URL(url) : url;
  } catch {
    return { trust: null, reason: 'invalid-url' };
  }
  if (parsed.protocol !== HTTPS_PROTOCOL && parsed.protocol !== HTTP_PROTOCOL) {
    return { trust: null, reason: 'unsupported-scheme' };
  }
  if (parsed.origin === API_ORIGIN) return { trust: 'api', url: parsed };
  const hostname = normalizeHostname(parsed.hostname);
  // A declared public host may arrive over plaintext (Mojang hands out
  // `http://textures.minecraft.net/...`); enforceTransport upgrades it before the
  // request is issued, so the socket is still TLS.
  if (policy.publicHosts?.some((host) => host.toLowerCase() === hostname)) {
    return { trust: 'public', url: parsed };
  }
  if (policy.allowLocalHosts && isLocalOrTestHost(hostname)) {
    return { trust: 'public', url: parsed };
  }
  if (parsed.protocol === HTTP_PROTOCOL) return { trust: null, reason: 'insecure-transport' };
  return { trust: null, reason: 'untrusted-host' };
};

export const trustOf = (url: string | URL, policy: OriginPolicy = {}): OriginTrust | null =>
  classifyUrl(url, policy).trust;

// Never open a plaintext socket to a non-local host: the same path is served over
// TLS. Applied to the effective request URL, not just the initial one, so a
// redirect can't smuggle the fetch back onto HTTP.
export const enforceTransport = (url: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== HTTP_PROTOCOL || isLocalOrTestHost(parsed.hostname)) return url;
  parsed.protocol = HTTPS_PROTOCOL;
  return parsed.toString();
};

// A 30x may not drop TLS. Compared on the effective (post-enforceTransport) hop,
// so an upgraded plaintext start doesn't read as a downgrade.
export const isTransportDowngrade = (from: URL, to: URL): boolean =>
  from.protocol === HTTPS_PROTOCOL && to.protocol === HTTP_PROTOCOL;
