import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Loaders, type Target, assertNever } from '@loontail/minecraft-kit';
import { SIDECAR_DIR } from '@main/constants/paths';
import { scopedLogger } from '@main/infra/logger';
import type { CatalogKey } from '@shared/contracts/ids';
import { z } from 'zod';

const TARGET_INSTALL_MANIFEST_FILE = 'manifest.json';
const TARGET_INSTALL_MANIFEST_VERSION = 1;

const logger = scopedLogger('minecraft.installManifest');

// Inlined by electron-vite's `define` (electron.vite.config.ts) from the resolved
// kit package.json. Declared module-locally (not as a global .d.ts) so the test
// project, which does not include src/main, still type-checks this module.
declare const __MINECRAFT_KIT_VERSION__: string;

// Reading the kit version from the build-time constant keeps the packaged bundle
// from recording `kitVersion: 'unknown'` when node_modules is absent (DLI-71).
// The require branch only runs under the test runner (no define); Vite
// dead-code-eliminates it from the production bundle once the literal substitutes.
const MINECRAFT_KIT_VERSION =
  typeof __MINECRAFT_KIT_VERSION__ !== 'undefined'
    ? __MINECRAFT_KIT_VERSION__
    : (
        createRequire(import.meta.url)('@loontail/minecraft-kit/package.json') as {
          version: string;
        }
      ).version;

const loaderTypeSchema = z.enum([Loaders.VANILLA, Loaders.FABRIC, Loaders.FORGE]);

const TargetInstallManifestSchema = z.object({
  version: z.literal(TARGET_INSTALL_MANIFEST_VERSION),
  targetId: z.string().min(1),
  minecraftVersion: z.string().min(1),
  loader: z.object({
    type: loaderTypeSchema,
    version: z.string().nullable(),
  }),
  runtime: z.object({
    component: z.string().min(1),
    platformKey: z.string().min(1).optional(),
    versionName: z.string().min(1).optional(),
    majorVersion: z.number().int().optional(),
  }),
  kitVersion: z.string().min(1),
  verifiedAt: z.string().datetime(),
});

export type TargetInstallManifest = z.infer<typeof TargetInstallManifestSchema>;

const loaderVersionFor = (target: Target): string | null => {
  switch (target.loader.type) {
    case Loaders.FABRIC:
      return target.loader.loaderVersion;
    case Loaders.FORGE:
      return target.loader.forgeVersion;
    case Loaders.VANILLA:
      return null;
    default:
      return assertNever(target.loader);
  }
};

export const targetInstallManifestPath = (clientFolder: string): string =>
  path.join(clientFolder, SIDECAR_DIR, TARGET_INSTALL_MANIFEST_FILE);

export const createTargetInstallManifest = (
  target: Target,
  verifiedAt: Date = new Date(),
  kitVersion: string = MINECRAFT_KIT_VERSION,
): TargetInstallManifest => ({
  version: TARGET_INSTALL_MANIFEST_VERSION,
  targetId: target.id,
  minecraftVersion: target.minecraft.version,
  loader: {
    type: target.loader.type,
    version: loaderVersionFor(target),
  },
  runtime: {
    component: target.runtime.component,
    ...(target.runtime.platformKey ? { platformKey: target.runtime.platformKey } : {}),
    ...(target.runtime.versionName ? { versionName: target.runtime.versionName } : {}),
    ...(target.runtime.majorVersion !== undefined
      ? { majorVersion: target.runtime.majorVersion }
      : {}),
  },
  kitVersion,
  verifiedAt: verifiedAt.toISOString(),
});

export const loadTargetInstallManifest = async (
  clientFolder: string,
): Promise<TargetInstallManifest | null> => {
  const target = targetInstallManifestPath(clientFolder);
  try {
    const raw = await fs.readFile(target, 'utf8');
    const parsed = TargetInstallManifestSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      logger.warn(`Target install manifest at ${target} is malformed; discarding`);
      return null;
    }
    return parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    logger.warn(`Failed to read target install manifest at ${target}`, error);
    return null;
  }
};

export const saveTargetInstallManifest = async (
  clientFolder: string,
  manifest: TargetInstallManifest,
): Promise<void> => {
  const target = targetInstallManifestPath(clientFolder);
  const temporaryTarget = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.writeFile(temporaryTarget, JSON.stringify(manifest, null, 2), 'utf8');
    // Atomic swap. On Windows fs.rename fails when the target exists; remove
    // first (idempotent on ENOENT) then rename so a retry starts clean.
    await fs.rm(target, { force: true });
    await fs.rename(temporaryTarget, target);
  } catch (error) {
    await fs.rm(temporaryTarget, { force: true }).catch(() => {});
    throw error;
  }
};

export const saveCurrentTargetInstallManifest = async (
  clientFolder: string,
  target: Target,
): Promise<void> => {
  await saveTargetInstallManifest(clientFolder, createTargetInstallManifest(target));
};

// Best-effort sidecar write: a failure here must not demote a successful
// install/repair, so it warns and swallows. `logPrefix` tags the operation that
// triggered the write ('install' / 'repair').
export const persistTargetInstallManifest = async (
  slug: CatalogKey,
  clientFolder: string,
  target: Target,
  logPrefix: string,
): Promise<void> => {
  try {
    await saveCurrentTargetInstallManifest(clientFolder, target);
  } catch (error) {
    logger.warn(`[${slug}] ${logPrefix}: failed to persist target install manifest`, error);
  }
};

export const clearTargetInstallManifest = async (clientFolder: string): Promise<void> => {
  try {
    await fs.unlink(targetInstallManifestPath(clientFolder));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Failed to clear target install manifest', error);
    }
  }
};

export const targetInstallManifestMatches = (
  manifest: TargetInstallManifest,
  target: Target,
  kitVersion: string = MINECRAFT_KIT_VERSION,
): boolean =>
  manifest.targetId === target.id &&
  manifest.minecraftVersion === target.minecraft.version &&
  manifest.loader.type === target.loader.type &&
  manifest.loader.version === loaderVersionFor(target) &&
  manifest.runtime.component === target.runtime.component &&
  manifest.runtime.platformKey === target.runtime.platformKey &&
  manifest.runtime.versionName === target.runtime.versionName &&
  manifest.kitVersion === kitVersion;

export const hasCurrentTargetInstallManifest = async (
  clientFolder: string,
  target: Target,
): Promise<boolean> => {
  const manifest = await loadTargetInstallManifest(clientFolder);
  return manifest !== null && targetInstallManifestMatches(manifest, target);
};
