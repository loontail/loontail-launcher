import { type BundleRuntimeState, useBundleStatus } from '@renderer/features/bundle';
import { type ClientRuntimeState, useClientStatus } from '@renderer/features/minecraft';
import { useLauncherSettings } from '@renderer/features/settings';
import type { Client } from '@shared/contracts/client';
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

// Single composite hook so callers don't have to coordinate two stores inline.
// Memoizes the derived view to keep referential stability across renders where
// the underlying state is unchanged.
//
// `hasLoader` is derived the same way the main-process install pipeline picks
// the loader: persisted override → client's loader fields → vanilla.
export const useInstallProgress = (client: Client): ClientInstallProgress => {
  const install = useClientStatus(client.slug);
  const bundle = useBundleStatus(client.slug);
  const { settings } = useLauncherSettings();
  const hasBundle = Boolean(client.bundleSlug);
  const persistedLoader = settings?.clients[client.slug]?.loader ?? null;
  const resolution = resolveLoader(client, persistedLoader);
  const hasLoader = resolution.kind === 'resolved' && resolution.loader !== LoaderChoices.VANILLA;
  const progress = useMemo(
    () => selectInstallProgress(install, bundle, { hasBundle, hasLoader }),
    [install, bundle, hasBundle, hasLoader],
  );
  return { install, bundle, hasBundle, hasLoader, progress };
};
