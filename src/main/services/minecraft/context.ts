import type { MinecraftKit, Target } from '@loontail/minecraft-kit';
import { getClient } from '@main/services/clients';
import {
  getSettings,
  setClientOverride as persistClientOverride,
} from '@main/services/settings/settings';
import type { Client } from '@shared/contracts/client';
import type { ClientSlug } from '@shared/contracts/ids';
import { MinecraftErrorCodes } from '@shared/contracts/minecraft';
import type { LoaderChoice } from '@shared/contracts/settings';
import { isLoaderAvailable } from '@shared/domain/loader';
import { resolveClientSettings } from '@shared/domain/settings';
import { ManagerError } from './errors';
import { getRuntimeRoot } from './runtimeFs';
import { clientToTargetInput, resolveLoader } from './target';

export type Context = {
  client: Client;
  clientFolder: string;
  loader: LoaderChoice;
  target: Target;
  resolved: ReturnType<typeof resolveClientSettings>;
};

export const buildContext = async (
  kit: MinecraftKit,
  slug: ClientSlug,
  loaderOverride?: LoaderChoice,
): Promise<Context> => {
  let client: Client;
  try {
    client = await getClient(slug);
  } catch {
    throw new ManagerError(MinecraftErrorCodes.UNKNOWN, `Client "${slug}" not found`);
  }

  const settings = getSettings();
  const resolved = resolveClientSettings(settings, slug);
  if (!resolved.storage.clientFolder) {
    throw new ManagerError(
      MinecraftErrorCodes.NO_CLIENT_FOLDER,
      'Set the launcher install folder in System settings first',
    );
  }

  const rawPersisted = settings.clients[slug]?.loader ?? null;
  const persisted = rawPersisted && isLoaderAvailable(client, rawPersisted) ? rawPersisted : null;
  if (rawPersisted && !persisted) {
    // Strapi removed the loader the user once picked — drop the stale override
    // so future reads (UI, launch) see a clean state.
    persistClientOverride(slug, { loader: undefined });
  }
  const resolution = resolveLoader(client, loaderOverride ?? persisted);
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
    clientToTargetInput({
      client,
      clientFolder: resolved.storage.clientFolder,
      runtimeRoot: getRuntimeRoot(),
      loader: resolution.loader,
    }),
  );
  return {
    client,
    clientFolder: resolved.storage.clientFolder,
    loader: resolution.loader,
    target,
    resolved,
  };
};
