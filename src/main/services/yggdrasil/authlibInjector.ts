import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { YggdrasilError, YggdrasilErrorCodes } from '@shared/yggdrasil/errors';
import { app } from 'electron';

// Single source of truth for the vendored jar: `scripts/fetchAuthlibInjector.mjs`
// parses this constant to decide what to download, and the resolver below builds
// the filename from it. Bump it here and nowhere else.
export const AUTHLIB_INJECTOR_VERSION = '1.2.5';

const VENDOR_DIRNAME = 'authlib-injector';
const VENDOR_DIR_ENV = 'LOONTAIL_AUTHLIB_INJECTOR_VENDOR_DIR';

export const authlibInjectorJarName = (): string =>
  `authlib-injector-${AUTHLIB_INJECTOR_VERSION}.jar`;

const vendorDir = (): string => {
  const override = process.env[VENDOR_DIR_ENV];
  if (override) return override;
  // Packaged: electron-builder copies `vendor/authlib-injector` into resources/.
  // Unpackaged: main runs from `out/main`, two levels under the repo root where
  // the fetch script drops the jar.
  return app.isPackaged
    ? path.join(process.resourcesPath, VENDOR_DIRNAME)
    : path.resolve(__dirname, '..', '..', 'vendor', VENDOR_DIRNAME);
};

export const resolveAuthlibInjectorJarPath = (): string => {
  const dir = vendorDir();
  const jarPath = path.join(dir, authlibInjectorJarName());
  if (existsSync(jarPath)) return jarPath;
  throw new YggdrasilError(
    YggdrasilErrorCodes.AUTHLIB_INJECTOR_MISSING,
    `authlib-injector jar not found: ${jarPath}`,
    { context: { dir, files: existsSync(dir) ? readdirSync(dir) : [] } },
  );
};

export const buildAuthlibInjectorJvmArg = (input: {
  readonly jarPath: string;
  readonly apiRoot: string;
}): string => `-javaagent:${input.jarPath}=${input.apiRoot}`;
