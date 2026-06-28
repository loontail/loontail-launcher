import { Loaders, type TargetResolveInput, asMinecraftVersionId } from '@loontail/minecraft-kit';
import type { BuildSpec } from '@shared/contracts/catalog';
import { type LoaderChoice, LoaderChoices } from '@shared/contracts/settings';

export { resolveLoader, type LoaderResolution } from '@shared/domain/loader';

// Maps a BuildSpec onto the kit's target input. `targetId` is the source-native
// identity (official slug or local instance UUID), kept stable so an existing
// install manifest's targetId keeps matching.
export const buildSpecToTargetInput = (input: {
  targetId: string;
  spec: BuildSpec;
  clientFolder: string;
  runtimeRoot: string;
  loader: LoaderChoice;
}): TargetResolveInput => {
  const { targetId, spec, clientFolder, runtimeRoot, loader } = input;
  // A pinned runtime component wins; falsy → kit picks from javaVersion.component.
  const runtimeComponent = spec.runtimeVersion?.trim() || undefined;
  return {
    id: targetId,
    directory: clientFolder,
    minecraft: { version: asMinecraftVersionId(spec.minecraftVersion) },
    loader: toKitLoader(loader, spec),
    runtime: {
      installRoot: runtimeRoot,
      ...(runtimeComponent ? { component: runtimeComponent } : {}),
    },
  };
};

const toKitLoader = (loader: LoaderChoice, spec: BuildSpec): TargetResolveInput['loader'] => {
  switch (loader) {
    case LoaderChoices.FORGE:
      return {
        type: Loaders.FORGE,
        ...(spec.forgeVersion ? { version: spec.forgeVersion } : {}),
      };
    case LoaderChoices.FABRIC:
      return {
        type: Loaders.FABRIC,
        ...(spec.fabricVersion ? { version: spec.fabricVersion } : {}),
      };
    default:
      return { type: Loaders.VANILLA };
  }
};
