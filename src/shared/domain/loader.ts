import { type LoaderChoice, LoaderChoices } from '@shared/contracts/settings';

type ClientLoaderFields = {
  forgeVersion?: string | null | undefined;
  fabricVersion?: string | null | undefined;
};

export type LoaderResolution = { kind: 'resolved'; loader: LoaderChoice } | { kind: 'ambiguous' };

/** Honours the user's override; otherwise derives the loader from set version fields. */
export const resolveLoader = (
  client: ClientLoaderFields,
  override: LoaderChoice | null,
): LoaderResolution => {
  if (override) return { kind: 'resolved', loader: override };
  const hasForge = Boolean(client.forgeVersion);
  const hasFabric = Boolean(client.fabricVersion);
  if (hasForge && hasFabric) return { kind: 'ambiguous' };
  if (hasForge) return { kind: 'resolved', loader: LoaderChoices.FORGE };
  if (hasFabric) return { kind: 'resolved', loader: LoaderChoices.FABRIC };
  return { kind: 'resolved', loader: LoaderChoices.VANILLA };
};
