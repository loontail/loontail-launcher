import { asMinecraftVersionId, Loaders, type TargetResolveInput } from '@loontail/minecraft-kit';
import type { BuildSpec } from '@shared/contracts/catalog';
import { type LoaderChoice, LoaderChoices } from '@shared/contracts/settings';

export { type LoaderResolution, resolveLoader } from '@shared/domain/loader';

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
  // why: a bare integer (legacy Java major like "25"/"21", pre-Mojang-component
  // migration) is not a valid runtime component — passing it crashes the install
  // ("Runtime component 25 not available"). Treat it as unset so the kit falls
  // back to the Minecraft manifest's javaVersion.component. Real component names
  // (e.g. "java-runtime-delta") still pass through.
  const trimmedRuntime = spec.runtimeVersion?.trim() ?? '';
  const runtimeComponent =
    trimmedRuntime === '' || /^\d+$/.test(trimmedRuntime) ? undefined : trimmedRuntime;
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
