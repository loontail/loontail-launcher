import type { MinecraftKit, Target } from '@loontail/minecraft-kit';
import { resolveBuildByOpaqueId as defaultResolveBuild } from '@main/services/catalog';
import {
  getSettings as defaultGetSettings,
  setClientOverride as defaultPersistClientOverride,
} from '@main/services/settings/settings';
import type { CatalogItem } from '@shared/contracts/catalog';
import type { ClientSlug } from '@shared/contracts/ids';
import { MinecraftErrorCodes } from '@shared/contracts/minecraft';
import type {
  ClientSettingsOverride,
  LauncherSettings,
  LoaderChoice,
  ResolvedClientSettings,
} from '@shared/contracts/settings';
import { isLoaderAvailable } from '@shared/domain/loader';
import { clearStaleClientRuntimeRef, resolveClientSettings } from '@shared/domain/settings';
import { ManagerError } from './errors';
import { getRuntimeRoot } from './runtimeFs';
import { buildSpecToTargetInput, resolveLoader } from './target';

export type Context = {
  // The resolved build (official or local), source-agnostic. Downstream reads
  // its `spec` (kit inputs) and `presentation` (display) rather than the
  // Strapi-specific Client shape.
  item: CatalogItem;
  clientFolder: string;
  loader: LoaderChoice;
  target: Target;
  resolved: ResolvedClientSettings;
};

// Injection seam: buildContext resolves the build through the catalog, reads
// settings, and persists stale-override fixups — tests pass stubs here to
// exercise it without touching the store or the live catalog. Each field
// falls back to the real module-level dependency when omitted.
export type BuildContextDeps = {
  getSettings?: () => LauncherSettings;
  persistClientOverride?: (slug: ClientSlug, patch: ClientSettingsOverride) => LauncherSettings;
  // Resolves the build from its opaque operational id (local UUID or official
  // slug), trying the local source first so a local build resolves offline.
  resolveBuild?: (id: ClientSlug) => Promise<CatalogItem | null>;
};

export const buildContext = async (
  kit: MinecraftKit,
  slug: ClientSlug,
  loaderOverride?: LoaderChoice,
  deps: BuildContextDeps = {},
): Promise<Context> => {
  const getSettings = deps.getSettings ?? defaultGetSettings;
  const persistClientOverride = deps.persistClientOverride ?? defaultPersistClientOverride;
  const resolveBuild = deps.resolveBuild ?? defaultResolveBuild;

  // The id flowing through the slug-keyed chain is an opaque build id: a local
  // instance UUID or an official Strapi slug. The resolver disambiguates by
  // source (local first, network-free), so local builds resolve with the CMS down.
  let item: CatalogItem | null;
  try {
    item = await resolveBuild(slug);
  } catch {
    throw new ManagerError(MinecraftErrorCodes.UNKNOWN, `Build "${slug}" not found`);
  }
  if (!item) {
    throw new ManagerError(MinecraftErrorCodes.UNKNOWN, `Build "${slug}" not found`);
  }
  const spec = item.spec;

  const settings = getSettings();
  let resolved = resolveClientSettings(settings, slug);
  if (!resolved.storage.clientFolder) {
    throw new ManagerError(
      MinecraftErrorCodes.NO_CLIENT_FOLDER,
      'Set the launcher install folder in System settings first',
    );
  }

  const rawPersisted = settings.clients[slug]?.loader ?? null;
  const persisted = rawPersisted && isLoaderAvailable(spec, rawPersisted) ? rawPersisted : null;
  if (rawPersisted && !persisted) {
    // The build no longer offers the loader the user once picked — drop the
    // stale override so future reads (UI, launch) see a clean state.
    persistClientOverride(slug, { loader: undefined });
  }
  const resolution = resolveLoader(spec, loaderOverride ?? persisted);
  if (resolution.kind === 'ambiguous') {
    throw new ManagerError(
      MinecraftErrorCodes.LOADER_AMBIGUOUS,
      'Pick a loader (Forge or Fabric) before installing',
    );
  }
  if (loaderOverride && loaderOverride !== persisted) {
    persistClientOverride(slug, { loader: loaderOverride });
  }

  const target = await kit.targets.resolve(
    buildSpecToTargetInput({
      targetId: slug,
      spec,
      clientFolder: resolved.storage.clientFolder,
      runtimeRoot: getRuntimeRoot(),
      loader: resolution.loader,
    }),
  );
  const runtimeCheckedSettings = clearStaleClientRuntimeRef(
    settings,
    slug,
    target.runtime.component,
  );
  if (runtimeCheckedSettings !== settings) {
    const persistedSettings = persistClientOverride(slug, { runtime: undefined });
    resolved = resolveClientSettings(persistedSettings, slug);
  }
  return {
    item,
    clientFolder: resolved.storage.clientFolder,
    loader: resolution.loader,
    target,
    resolved,
  };
};
