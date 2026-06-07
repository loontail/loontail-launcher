import type { CatalogItem } from '@shared/contracts/catalog';
import { type LoaderChoice, LoaderChoices } from '@shared/contracts/settings';

// Pure presentation helpers shared by the tile and the detail modal — kept out
// of the components so the view model is testable and the components stay thin.

// The loader to surface in compact UI. A build that ships both Forge and Fabric
// (the loader is picked at install) shows Forge here; the modal/loader picker
// still lets the user choose.
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

// A stable hue derived from the build key so the generated fallback visual is
// consistent per build across renders without storing anything.
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
