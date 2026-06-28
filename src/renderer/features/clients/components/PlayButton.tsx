import { localizeBundleError, useStartBundle } from '@renderer/features/bundle';
import { operationalId } from '@renderer/features/catalog';
import {
  localizeMinecraftError,
  useCancelInstall,
  useInstallClient,
  useLaunchClient,
  useStopClient,
} from '@renderer/features/minecraft';
import { useLauncherSettings, useResolveFor } from '@renderer/features/settings';
import {
  BUSY_BUNDLE_STATUSES,
  type BundleSyncStatus,
  BundleSyncStatuses,
} from '@shared/contracts/bundle';
import type { CatalogItem } from '@shared/contracts/catalog';
import { type InstallStatus, InstallStatuses } from '@shared/contracts/minecraft';
import type { LoaderChoice } from '@shared/contracts/settings';
import { isLoaderAmbiguous, isLoaderAvailable } from '@shared/domain/loader';
import { Download, Loader2, Play, RefreshCw, RotateCcw, Square, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderChoiceModal } from './LoaderChoiceModal';
import { ActionButton, InstallProgress, useInstallProgress } from './install';

type PlayButtonProps = { item: CatalogItem };

export const PlayButtonActions = {
  PROGRESS: 'progress',
  BUNDLE_ERROR: 'bundle-error',
  BUNDLE_UPDATE: 'bundle-update',
  UNINSTALLING: 'uninstalling',
  LAUNCHING: 'launching',
  RUNNING: 'running',
  PLAY: 'play',
  UNVERIFIED: 'unverified',
  CHECKING: 'checking',
  REPAIRING: 'repairing',
  STATUS_PENDING: 'status-pending',
  ERROR: 'error',
  INSTALL: 'install',
} as const;

export type PlayButtonAction = (typeof PlayButtonActions)[keyof typeof PlayButtonActions];

const SpinnerButton = ({ label }: { label: string }) => (
  <ActionButton disabled>
    <Loader2 size={16} className="animate-spin" />
    {label}
  </ActionButton>
);

const ErrorSurface = ({
  message,
  children,
}: {
  message: string | null;
  children: ReactNode;
}) => (
  <div className="flex max-w-[480px] flex-col gap-2">
    {message && (
      <p role="alert" className="text-caption leading-snug text-destructive">
        {message}
      </p>
    )}
    {children}
  </div>
);

type PlayButtonSelectionInput = {
  status: InstallStatus;
  hasProgress: boolean;
  hasBundle: boolean;
  bundleStatus: BundleSyncStatus;
  bundleInstalled: boolean;
  bundleSignatureMatches: boolean;
  hasBundleError: boolean;
  isChecking: boolean;
};

export const selectPlayButtonAction = ({
  status,
  hasProgress,
  hasBundle,
  bundleStatus,
  bundleInstalled,
  bundleSignatureMatches,
  hasBundleError,
  isChecking,
}: PlayButtonSelectionInput): PlayButtonAction => {
  if (hasProgress) return PlayButtonActions.PROGRESS;
  // A bundle sync that is busy but not yet downloading (manifest fetch,
  // planning, deleting, healing) has no card to show — surface a spinner so we
  // never flash a stale Play/Update/Download affordance mid-sync.
  if (hasBundle && BUSY_BUNDLE_STATUSES.has(bundleStatus)) {
    return PlayButtonActions.CHECKING;
  }
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
  // INSTALLING before the first progress event = the planning/checking phase
  // (the card only mounts once bytes are flowing). Show the same spinner.
  if (status === InstallStatuses.INSTALLING) {
    return PlayButtonActions.CHECKING;
  }
  if (
    isChecking &&
    (status === InstallStatuses.INSTALLED || status === InstallStatuses.UNVERIFIED)
  ) {
    return PlayButtonActions.CHECKING;
  }

  switch (status) {
    case InstallStatuses.UNKNOWN:
      return PlayButtonActions.STATUS_PENDING;
    case InstallStatuses.REPAIRING:
      return PlayButtonActions.REPAIRING;
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

export const PlayButton = ({ item }: PlayButtonProps) => {
  const { t } = useTranslation();
  const slug = operationalId(item);
  const spec = item.spec;
  const { install: state, bundle, hasBundle, progress } = useInstallProgress(item);
  const resolved = useResolveFor(slug);
  const { settings } = useLauncherSettings();

  const install = useInstallClient();
  const launch = useLaunchClient();
  const cancel = useCancelInstall();
  const stop = useStopClient();
  const startBundle = useStartBundle();
  const [loaderModalOpen, setLoaderModalOpen] = useState(false);

  const folderReady = Boolean(resolved?.storage.clientFolder);
  const rawPersistedLoader = settings?.clients[slug]?.loader ?? null;
  // Ignore a persisted choice that no longer matches the build's loader fields —
  // e.g. user picked Forge, then it was removed upstream. Without this the
  // launcher would skip the picker and try to install a loader the build lacks.
  const persistedLoader =
    rawPersistedLoader && isLoaderAvailable(spec, rawPersistedLoader) ? rawPersistedLoader : null;
  const needsLoaderChoice = isLoaderAmbiguous(spec, persistedLoader);

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
      clientTitle={item.presentation.title}
      forgeVersion={spec.forgeVersion}
      fabricVersion={spec.fabricVersion}
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
    isChecking: launch.isPending,
  });

  if (action === PlayButtonActions.PROGRESS && progress) {
    return (
      <>
        <InstallProgress slug={slug} view={progress} />
        {loaderModal}
      </>
    );
  }

  if (action === PlayButtonActions.BUNDLE_ERROR && bundle.error) {
    return (
      <ErrorSurface message={localizeBundleError(bundle.error.code, bundle.error.message, t)}>
        <ActionButton
          onClick={() => void startBundle.mutateAsync({ slug })}
          disabled={startBundle.isPending}
        >
          <RotateCcw size={16} />
          {t('clients.retry')}
        </ActionButton>
      </ErrorSurface>
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
    case PlayButtonActions.STATUS_PENDING:
      return <SpinnerButton label={t('clients.checking')} />;

    case PlayButtonActions.UNINSTALLING:
      return <SpinnerButton label={t('clients.uninstalling')} />;

    case PlayButtonActions.LAUNCHING:
      return (
        <ActionButton
          variant="muted"
          onClick={() => void cancel.mutateAsync(slug)}
          disabled={cancel.isPending}
          title={t('clients.launching')}
        >
          <X size={16} />
          {t('clients.cancel')}
        </ActionButton>
      );

    case PlayButtonActions.CHECKING:
      return <SpinnerButton label={t('clients.checking')} />;

    case PlayButtonActions.REPAIRING:
      return <SpinnerButton label={t('clients.repairing')} />;

    case PlayButtonActions.RUNNING:
      return (
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 text-body-med text-glass/85">
            <span
              className="size-2 rounded-full bg-glass motion-safe:animate-pulse"
              aria-hidden="true"
            />
            {t('clients.running')}
          </span>
          <ActionButton variant="muted" onClick={() => void stop.mutateAsync(slug)}>
            <Square size={16} />
            {t('clients.stop')}
          </ActionButton>
        </div>
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
        <ErrorSurface message={errorText}>
          <div className="flex items-start gap-3">
            <ActionButton onClick={startOrPickLoader} disabled={!folderReady || install.isPending}>
              <RotateCcw size={16} />
              {t('clients.retry')}
            </ActionButton>
          </div>
          {loaderModal}
        </ErrorSurface>
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
