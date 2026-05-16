import { Loaders, type TargetResolveInput } from '@loontail/minecraft-kit';
import type { Client } from '@shared/contracts/client';
import { type LoaderChoice, LoaderChoices } from '@shared/contracts/settings';

export { resolveLoader, type LoaderResolution } from '@shared/domain/loader';

export const targetIdFor = (client: Client): string => client.slug;

export const clientToTargetInput = (input: {
  client: Client;
  clientFolder: string;
  runtimeRoot: string;
  loader: LoaderChoice;
}): TargetResolveInput => {
  const { client, clientFolder, runtimeRoot, loader } = input;
  // Admins use Strapi's `runtimeVersion` to pin a runtime; otherwise the kit
  // picks one from the resolved Minecraft manifest's javaVersion.component.
  const runtimeComponent = client.runtimeVersion?.trim() || undefined;
  return {
    id: targetIdFor(client),
    directory: clientFolder,
    minecraft: { version: client.minecraftVersion },
    loader: toKitLoader(loader, client),
    runtime: {
      installRoot: runtimeRoot,
      ...(runtimeComponent ? { component: runtimeComponent } : {}),
    },
  };
};

const toKitLoader = (loader: LoaderChoice, client: Client): TargetResolveInput['loader'] => {
  switch (loader) {
    case LoaderChoices.FORGE:
      return {
        type: Loaders.FORGE,
        ...(client.forgeVersion ? { version: client.forgeVersion } : {}),
      };
    case LoaderChoices.FABRIC:
      return {
        type: Loaders.FABRIC,
        ...(client.fabricVersion ? { version: client.fabricVersion } : {}),
      };
    default:
      return { type: Loaders.VANILLA };
  }
};
