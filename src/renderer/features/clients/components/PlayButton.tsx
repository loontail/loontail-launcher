import { localizeBundleError, useStartBundle } from '@renderer/features/bundle';
import {
  localizeMinecraftError,
  useCancelInstall,
  useInstallClient,
  useLaunchClient,
  useStopClient,
} from '@renderer/features/minecraft';
import { useLauncherSettings, useResolveFor } from '@renderer/features/settings';
import { type BundleSyncStatus, BundleSyncStatuses } from '@shared/contracts/bundle';
import type { Client } from '@shared/contracts/client';
import { type InstallStatus, InstallStatuses } from '@shared/contracts/minecraft';
import type { LoaderChoice } from '@shared/contracts/settings';
import { isLoaderAvailable } from '@shared/domain/loader';
import { Download, Loader2, Play, RefreshCw, RotateCcw, Square, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderChoiceModal } from './LoaderChoiceModal';
import { ActionButton, InstallProgress, useInstallProgress } from './install';

type PlayButtonProps = { client: Client };

export const PlayButtonActions = {
  PROGRESS: 'progress',
  BUNDLE_ERROR: 'bundle-error',
  BUNDLE_UPDATE: 'bundle-update',
  UNINSTALLING: 'uninstalling',
  LAUNCHING: 'launching',
  RUNNING: 'running',
  PLAY: 'play',
  UNVERIFIED: 'unverified',
  ERROR: 'error',
  INSTALL: 'install',
} as const;

export type PlayButtonAction = (typeof PlayButtonActions)[keyof typeof PlayButtonActions];

type PlayButtonSelectionInput = {
  status: InstallStatus;
  hasProgress: boolean;
  hasBundle: boolean;
  bundleStatus: BundleSyncStatus;
  bundleInstalled: boolean;
  bundleSignatureMatches: boolean;
  hasBundleError: boolean;
};

export const selectPlayButtonAction = ({
  status,
  hasProgress,
  hasBundle,
  bundleStatus,
  bundleInstalled,
  bundleSignatureMatches,
  hasBundleError,
}: PlayButtonSelectionInput): PlayButtonAction => {
  if (hasProgress) return PlayButtonActions.PROGRESS;
  if (
    hasBundle &&
    bundleStatus === BundleSyncStatuses.ERROR &&
    hasBundleError &&
    status === InstallStatuses.INSTALLED
  ) {
    return PlayButtonActions.BUNDLE_ERROR;
  }
  if (
    hasBundle &&
    bundleInstalled &&
    !bundleSignatureMatches &&
    status === InstallStatuses.INSTALLED
  ) {
    return PlayButtonActions.BUNDLE_UPDATE;
  }

  switch (status) {
    case InstallStatuses.UNINSTALLING:
      return PlayButtonActions.UNINSTALLING;
    case InstallStatuses.LAUNCHING:
      return PlayButtonActions.LAUNCHING;
    case InstallStatuses.RUNNING:
      return PlayButtonActions.RUNNING;
    case InstallStatuses.INSTALLED:
      return PlayButtonActions.PLAY;
    case InstallStatuses.UNVERIFIED:
      return PlayButtonActions.UNVERIFIED;
    case InstallStatuses.ERROR:
      return PlayButtonActions.ERROR;
    default:
      return PlayButtonActions.INSTALL;
  }
};

export const PlayButton = ({ client }: PlayButtonProps) => {
  const { t } = useTranslation();
  const slug = client.slug;
  const { install: state, bundle, hasBundle, progress } = useInstallProgress(client);
  const resolved = useResolveFor(slug);
  const { settings } = useLauncherSettings();

  const install = useInstallClient();
  const launch = useLaunchClient();
  const cancel = useCancelInstall();
  const stop = useStopClient();
  const startBundle = useStartBundle();
  const [loaderModalOpen, setLoaderModalOpen] = useState(false);

  if (!slug) return null;

  const folderReady = Boolean(resolved?.storage.clientFolder);
  const rawPersistedLoader = settings?.clients[slug]?.loader ?? null;
  // Ignore a persisted choice that no longer matches the client's loader fields —
  // e.g. user picked Forge, then Strapi removed forgeVersion. Without this the
  // launcher would skip the picker and try to install a loader the client lacks.
  const persistedLoader =
    rawPersistedLoader && isLoaderAvailable(client, rawPersistedLoader) ? rawPersistedLoader : null;
  const needsLoaderChoice =
    Boolean(client.forgeVersion) && Boolean(client.fabricVersion) && !persistedLoader;

  const beginInstall = (loader?: LoaderChoice): Promise<void> =>
    install.mutateAsync({ slug, ...(loader ? { loader } : {}) });

  const startOrPickLoader = (): void => {
    if (!folderReady) return;
    if (needsLoaderChoice) {
      setLoaderModalOpen(true);
      return;
    }
    void beginInstall();
  };

  const loaderModal = (
    <LoaderChoiceModal
      isOpen={loaderModalOpen}
      clientTitle={client.title}
      forgeVersion={client.forgeVersion}
      fabricVersion={client.fabricVersion}
      onPick={(loader) => void beginInstall(loader)}
      onClose={() => setLoaderModalOpen(false)}
    />
  );

  const action = selectPlayButtonAction({
    status: state.status,
    hasProgress: Boolean(progress),
    hasBundle,
    bundleStatus: bundle.status,
    bundleInstalled: bundle.installed,
    bundleSignatureMatches: bundle.signatureMatches,
    hasBundleError: Boolean(bundle.error),
  });

  // Progress card wins over the per-status switch below whenever an install
  // or bundle sync is in flight. Selector returns null otherwise and the
  // card collapses immediately — no transient success state.
  if (action === PlayButtonActions.PROGRESS && progress) {
    return (
      <>
        <InstallProgress slug={slug} view={progress} />
        {loaderModal}
      </>
    );
  }

  // Bundle error surface: render under the Play affordance so the user can
  // retry without leaving the client page.
  if (action === PlayButtonActions.BUNDLE_ERROR && bundle.error) {
    const errorText = localizeBundleError(bundle.error.code, bundle.error.message, t);
    return (
      <div className="flex max-w-[480px] flex-col gap-2">
        <p role="alert" className="text-caption leading-snug text-destructive">
          {errorText}
        </p>
        <ActionButton
          onClick={() => void startBundle.mutateAsync({ slug })}
          disabled={startBundle.isPending}
        >
          <RotateCcw size={16} />
          {t('clients.retry')}
        </ActionButton>
      </div>
    );
  }

  if (action === PlayButtonActions.BUNDLE_UPDATE) {
    return (
      <ActionButton
        onClick={() => void startBundle.mutateAsync({ slug })}
        disabled={startBundle.isPending}
      >
        <RefreshCw size={16} />
        {t('clients.update')}
      </ActionButton>
    );
  }

  switch (action) {
    case PlayButtonActions.UNINSTALLING:
      return (
        <ActionButton disabled>
          <Loader2 size={16} className="animate-spin" />
          {t('clients.uninstalling')}
        </ActionButton>
      );

    case PlayButtonActions.LAUNCHING:
      return (
        <ActionButton
          onClick={() => void cancel.mutateAsync(slug)}
          disabled={cancel.isPending}
          className="bg-destructive text-destructive-foreground"
          title={t('clients.launching')}
        >
          <X size={16} />
          {t('clients.cancel')}
        </ActionButton>
      );

    case PlayButtonActions.RUNNING:
      return (
        <ActionButton
          onClick={() => void stop.mutateAsync(slug)}
          className="bg-destructive text-destructive-foreground"
        >
          <Square size={16} />
          {t('clients.stop')}
        </ActionButton>
      );

    case PlayButtonActions.PLAY:
      return (
        <ActionButton onClick={() => void launch.mutateAsync(slug)} disabled={launch.isPending}>
          <Play size={16} />
          {t('clients.play')}
        </ActionButton>
      );

    case PlayButtonActions.UNVERIFIED:
      return (
        <ActionButton
          onClick={() => void launch.mutateAsync(slug)}
          disabled={!folderReady || launch.isPending}
          title={folderReady ? undefined : t('clients.setInstallFolder')}
        >
          <RefreshCw size={16} />
          {t('clients.retry')}
        </ActionButton>
      );

    case PlayButtonActions.ERROR: {
      const errorText = state.error
        ? localizeMinecraftError(state.error.code, state.error.message, t)
        : null;
      return (
        <div className="flex max-w-[480px] flex-col gap-2">
          {errorText && (
            <p role="alert" className="text-caption leading-snug text-destructive">
              {errorText}
            </p>
          )}
          <div className="flex items-start gap-3">
            <ActionButton onClick={startOrPickLoader} disabled={!folderReady || install.isPending}>
              <RotateCcw size={16} />
              {t('clients.retry')}
            </ActionButton>
          </div>
          {loaderModal}
        </div>
      );
    }

    default:
      return (
        <>
          <ActionButton
            onClick={startOrPickLoader}
            disabled={!folderReady || install.isPending}
            title={folderReady ? undefined : t('clients.setInstallFolder')}
          >
            <Download size={16} />
            {t('clients.download')}
          </ActionButton>
          {loaderModal}
        </>
      );
  }
};
