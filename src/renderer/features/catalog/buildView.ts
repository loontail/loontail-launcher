import type { CatalogItem } from '@shared/contracts/catalog';
import { type LoaderChoice, LoaderChoices } from '@shared/contracts/settings';

// A build shipping both loaders shows Forge in compact UI; the picker still lets
// the user choose at install.
export const primaryLoader = (item: CatalogItem): LoaderChoice => {
  const { forgeVersion, fabricVersion } = item.spec;
  if (forgeVersion) return LoaderChoices.FORGE;
  if (fabricVersion) return LoaderChoices.FABRIC;
  return LoaderChoices.VANILLA;
};

export const loaderVersionFor = (item: CatalogItem): string | null => {
  const loader = primaryLoader(item);
  if (loader === LoaderChoices.FORGE) return item.spec.forgeVersion ?? null;
  if (loader === LoaderChoices.FABRIC) return item.spec.fabricVersion ?? null;
  return null;
};

// Stable hue derived from the build key so the fallback visual stays consistent
// per build without persisting anything.
export const fallbackHue = (item: CatalogItem): number => {
  const key = item.key as string;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 360;
  }
  return hash;
};

export const buildInitial = (item: CatalogItem): string =>
  item.presentation.title.trim().charAt(0).toUpperCase() || '?';
