import { type BundleRuntimeState, useBundleStatus } from '@renderer/features/bundle';
import { type ClientRuntimeState, useClientStatus } from '@renderer/features/minecraft';
import { useLauncherSettings } from '@renderer/features/settings';
import type { CatalogItem } from '@shared/contracts/catalog';
import { LoaderChoices } from '@shared/contracts/settings';
import { resolveLoader } from '@shared/domain/loader';
import { useMemo } from 'react';
import { type InstallProgressView, selectInstallProgress } from './installSteps';

export type ClientInstallProgress = {
  install: ClientRuntimeState;
  bundle: BundleRuntimeState;
  hasBundle: boolean;
  hasLoader: boolean;
  progress: InstallProgressView | null;
};

// `hasLoader` mirrors the install pipeline's loader pick: persisted override → loader fields → vanilla.
export const useInstallProgress = (item: CatalogItem): ClientInstallProgress => {
  const slug = item.key;
  const spec = item.spec;
  const install = useClientStatus(slug);
  const bundle = useBundleStatus(slug);
  const { settings } = useLauncherSettings();
  const hasBundle = Boolean(spec.bundleSlug);
  const persistedLoader = settings?.clients[slug]?.loader ?? null;
  const resolution = resolveLoader(spec, persistedLoader);
  const hasLoader = resolution.kind === 'resolved' && resolution.loader !== LoaderChoices.VANILLA;
  const progress = useMemo(
    () => selectInstallProgress(install, bundle, { hasBundle, hasLoader }),
    [install, bundle, hasBundle, hasLoader],
  );
  return { install, bundle, hasBundle, hasLoader, progress };
};
