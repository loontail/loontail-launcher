import { type BundleSyncState, useBundleStatus } from '@renderer/features/bundle';
import { type BuildInstallState, useClientStatus } from '@renderer/features/minecraft';
import { useLauncherSettings } from '@renderer/features/settings';
import type { CatalogItem } from '@shared/contracts/catalog';
import { LoaderChoices } from '@shared/contracts/settings';
import { resolveLoader } from '@shared/domain/loader';
import { useMemo } from 'react';
import { type InstallProgressView, selectInstallProgress } from './installSteps';

export type BuildInstallProgress = {
  install: BuildInstallState;
  bundle: BundleSyncState;
  hasBundle: boolean;
  hasLoader: boolean;
  progress: InstallProgressView | null;
};

// `hasLoader` mirrors the install pipeline's loader pick: persisted override → loader fields → vanilla.
export const useInstallProgress = (item: CatalogItem): BuildInstallProgress => {
  const key = item.key;
  const spec = item.spec;
  const install = useClientStatus(key);
  const bundle = useBundleStatus(key);
  const { settings } = useLauncherSettings();
  const hasBundle = Boolean(spec.bundleSlug);
  const persistedLoader = settings?.clients[key]?.loader ?? null;
  const resolution = resolveLoader(spec, persistedLoader);
  const hasLoader = resolution.kind === 'resolved' && resolution.loader !== LoaderChoices.VANILLA;
  const progress = useMemo(
    () => selectInstallProgress(install, bundle, { hasBundle, hasLoader }),
    [install, bundle, hasBundle, hasLoader],
  );
  return { install, bundle, hasBundle, hasLoader, progress };
};
