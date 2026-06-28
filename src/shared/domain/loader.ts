import { type LoaderChoice, LoaderChoices } from '@shared/contracts/settings';

type ClientLoaderFields = {
  forgeVersion?: string | null | undefined;
  fabricVersion?: string | null | undefined;
};

export type LoaderResolution = { kind: 'resolved'; loader: LoaderChoice } | { kind: 'ambiguous' };

// An override is only meaningful when the client still has the loader version
// it points to. Without this guard, removing forge/fabric from the backend has no
// effect — the stored override keeps the launcher pinned to a missing loader.
export const isLoaderAvailable = (client: ClientLoaderFields, choice: LoaderChoice): boolean => {
  if (choice === LoaderChoices.FORGE) return Boolean(client.forgeVersion);
  if (choice === LoaderChoices.FABRIC) return Boolean(client.fabricVersion);
  return true;
};

export const resolveLoader = (
  client: ClientLoaderFields,
  override: LoaderChoice | null,
): LoaderResolution => {
  if (override && isLoaderAvailable(client, override)) {
    return { kind: 'resolved', loader: override };
  }
  const hasForge = Boolean(client.forgeVersion);
  const hasFabric = Boolean(client.fabricVersion);
  if (hasForge && hasFabric) return { kind: 'ambiguous' };
  if (hasForge) return { kind: 'resolved', loader: LoaderChoices.FORGE };
  if (hasFabric) return { kind: 'resolved', loader: LoaderChoices.FABRIC };
  return { kind: 'resolved', loader: LoaderChoices.VANILLA };
};

export const isLoaderAmbiguous = (
  client: ClientLoaderFields,
  override: LoaderChoice | null,
): boolean => resolveLoader(client, override).kind === 'ambiguous';

// Counts the non-vanilla loaders the build ships, so a forge-only build (which
// resolves to forge over an implicit vanilla) never offers a meaningless switch.
export const canChooseLoader = (client: ClientLoaderFields): boolean => {
  let available = 0;
  if (client.forgeVersion) available += 1;
  if (client.fabricVersion) available += 1;
  return available > 1;
};
