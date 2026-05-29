import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RENDERER_ENTRY_FILES = {
  Main: 'index.html',
  Console: 'console.html',
} as const;

export type RendererEntryFile = (typeof RENDERER_ENTRY_FILES)[keyof typeof RENDERER_ENTRY_FILES];

export type RendererLocation = {
  entryFile: RendererEntryFile;
  filePath: string;
  loadUrl: string | null;
  isAllowedUrl: (rawUrl: string) => boolean;
};

type RendererLocationOptions = {
  entryFile: RendererEntryFile;
  devServerUrl?: string | null;
  rendererRoot?: string;
};

const DEFAULT_RENDERER_ROOT = join(__dirname, '../renderer');
const FILE_PROTOCOL = 'file:';
const ROOT_PATH = '/';
const INDEX_PATH = '/index.html';

const safeParseUrl = (rawUrl: string): URL | null => {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
};

const normalizePathname = (pathname: string): string => {
  if (pathname.length === 0) return ROOT_PATH;
  if (pathname.startsWith(ROOT_PATH)) return pathname;
  return `${ROOT_PATH}${pathname}`;
};

const trimTrailingSlash = (pathname: string): string => {
  if (pathname === ROOT_PATH) return '';
  return pathname.endsWith(ROOT_PATH) ? pathname.slice(0, -1) : pathname;
};

const getDevBasePath = (pathname: string): string => {
  const normalized = normalizePathname(pathname);
  if (normalized === ROOT_PATH) return '';
  if (normalized.endsWith(INDEX_PATH)) return normalized.slice(0, -INDEX_PATH.length);
  return trimTrailingSlash(normalized);
};

const joinUrlPath = (basePath: string, entryFile: RendererEntryFile): string => {
  const base = trimTrailingSlash(normalizePathname(basePath));
  if (base.length === 0) return `${ROOT_PATH}${entryFile}`;
  return `${base}${ROOT_PATH}${entryFile}`;
};

const buildDevRendererUrl = (devServerUrl: string, entryFile: RendererEntryFile): string => {
  const parsed = safeParseUrl(devServerUrl);
  if (!parsed) return devServerUrl;
  if (entryFile === RENDERER_ENTRY_FILES.Main) return parsed.href;

  parsed.pathname = joinUrlPath(getDevBasePath(parsed.pathname), entryFile);
  parsed.search = '';
  parsed.hash = '';
  return parsed.href;
};

const buildDevAllowedPathnames = (
  devServerUrl: string,
  entryFile: RendererEntryFile,
): ReadonlySet<string> => {
  const parsed = safeParseUrl(devServerUrl);
  if (!parsed) return new Set();

  const basePath = getDevBasePath(parsed.pathname);
  if (entryFile !== RENDERER_ENTRY_FILES.Main) {
    return new Set([joinUrlPath(basePath, entryFile)]);
  }

  const configuredPath = normalizePathname(parsed.pathname);
  const rootPath = basePath.length === 0 ? ROOT_PATH : `${basePath}${ROOT_PATH}`;
  return new Set([configuredPath, rootPath, joinUrlPath(basePath, RENDERER_ENTRY_FILES.Main)]);
};

const isAllowedDevUrl = (
  rawUrl: string,
  devServerUrl: string,
  entryFile: RendererEntryFile,
): boolean => {
  const expected = safeParseUrl(devServerUrl);
  const parsed = safeParseUrl(rawUrl);
  if (!expected || !parsed) return false;
  if (parsed.origin !== expected.origin) return false;
  if (parsed.search.length > 0 || parsed.hash.length > 0) return false;

  return buildDevAllowedPathnames(devServerUrl, entryFile).has(normalizePathname(parsed.pathname));
};

const normalizeFilePath = (filePath: string): string => {
  const normalized = resolve(filePath);
  if (process.platform === 'win32') return normalized.toLowerCase();
  return normalized;
};

const isAllowedProductionFileUrl = (rawUrl: string, filePath: string): boolean => {
  const parsed = safeParseUrl(rawUrl);
  if (!parsed) return false;
  if (parsed.protocol !== FILE_PROTOCOL) return false;
  if (parsed.search.length > 0 || parsed.hash.length > 0) return false;

  try {
    return normalizeFilePath(fileURLToPath(parsed)) === normalizeFilePath(filePath);
  } catch {
    return false;
  }
};

export const createRendererLocation = (options: RendererLocationOptions): RendererLocation => {
  const rendererRoot = options.rendererRoot ?? DEFAULT_RENDERER_ROOT;
  const filePath = join(rendererRoot, options.entryFile);
  const devServerUrl =
    options.devServerUrl === undefined ? process.env.ELECTRON_RENDERER_URL : options.devServerUrl;

  if (devServerUrl) {
    return {
      entryFile: options.entryFile,
      filePath,
      loadUrl: buildDevRendererUrl(devServerUrl, options.entryFile),
      isAllowedUrl: (rawUrl) => isAllowedDevUrl(rawUrl, devServerUrl, options.entryFile),
    };
  }

  return {
    entryFile: options.entryFile,
    filePath,
    loadUrl: null,
    isAllowedUrl: (rawUrl) => isAllowedProductionFileUrl(rawUrl, filePath),
  };
};
