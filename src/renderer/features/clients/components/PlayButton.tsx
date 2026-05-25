import { localizeBundleError, useStartBundle } from '@renderer/features/bundle';
import {
  localizeMinecraftError,
  useInstallClient,
  useLaunchClient,
  useStopClient,
} from '@renderer/features/minecraft';
import { useLauncherSettings, useResolveFor } from '@renderer/features/settings';
import { BundleSyncStatuses } from '@shared/contracts/bundle';
import type { Client } from '@shared/contracts/client';
import { InstallStatuses } from '@shared/contracts/minecraft';
import type { LoaderChoice } from '@shared/contracts/settings';
import { isLoaderAvailable } from '@shared/domain/loader';
import { Download, Loader2, Play, RotateCcw, Square } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderChoiceModal } from './LoaderChoiceModal';
import { ActionBtn, InstallProgress, useInstallProgress } from './install';

type PlayButtonProps = { client: Client };

export const PlayButton = ({ client }: PlayButtonProps) => {
  const { t } = useTranslation();
  const slug = client.slug;
  const { install: state, bundle, hasBundle, progress } = useInstallProgress(client);
  const resolved = useResolveFor(slug);
  const { settings } = useLauncherSettings();

  const install = useInstallClient();
  const launch = useLaunchClient();
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

  // Progress card wins over the per-status switch below whenever an install
  // or bundle sync is in flight. Selector returns null otherwise and the
  // card collapses immediately — no transient success state.
  if (progress) {
    return (
      <>
        <InstallProgress slug={slug} view={progress} />
        {loaderModal}
      </>
    );
  }

  // Bundle error surface: render under the Play affordance so the user can
  // retry without leaving the client page.
  if (
    hasBundle &&
    bundle.status === BundleSyncStatuses.ERROR &&
    bundle.error &&
    state.status === InstallStatuses.INSTALLED
  ) {
    const errorText = localizeBundleError(bundle.error.code, bundle.error.message, t);
    return (
      <div className="flex max-w-[480px] flex-col gap-2">
        <p role="alert" className="text-[12px] leading-snug text-destructive">
          {errorText}
        </p>
        <ActionBtn
          onClick={() => void startBundle.mutateAsync({ slug })}
          disabled={startBundle.isPending}
        >
          <RotateCcw size={16} />
          {t('clients.retry')}
        </ActionBtn>
      </div>
    );
  }

  switch (state.status) {
    case InstallStatuses.UNINSTALLING:
      return (
        <ActionBtn disabled>
          <Loader2 size={16} className="animate-spin" />
          {t('clients.uninstalling')}
        </ActionBtn>
      );

    case InstallStatuses.LAUNCHING:
      return (
        <ActionBtn disabled>
          <Loader2 size={16} className="animate-spin" />
          {t('clients.launching')}
        </ActionBtn>
      );

    case InstallStatuses.RUNNING:
      return (
        <ActionBtn
          onClick={() => void stop.mutateAsync(slug)}
          className="bg-destructive text-destructive-foreground"
        >
          <Square size={16} />
          {t('clients.stop')}
        </ActionBtn>
      );

    case InstallStatuses.INSTALLED:
      return (
        <ActionBtn onClick={() => void launch.mutateAsync(slug)} disabled={launch.isPending}>
          <Play size={16} />
          {t('clients.play')}
        </ActionBtn>
      );

    case InstallStatuses.ERROR: {
      const errorText = state.error
        ? localizeMinecraftError(state.error.code, state.error.message, t)
        : null;
      return (
        <div className="flex max-w-[480px] flex-col gap-2">
          {errorText && (
            <p role="alert" className="text-[12px] leading-snug text-destructive">
              {errorText}
            </p>
          )}
          <div className="flex items-start gap-3">
            <ActionBtn onClick={startOrPickLoader} disabled={!folderReady || install.isPending}>
              <RotateCcw size={16} />
              {t('clients.retry')}
            </ActionBtn>
          </div>
          {loaderModal}
        </div>
      );
    }

    default:
      return (
        <>
          <ActionBtn
            onClick={startOrPickLoader}
            disabled={!folderReady || install.isPending}
            title={folderReady ? undefined : t('clients.setInstallFolder')}
          >
            <Download size={16} />
            {t('clients.download')}
          </ActionBtn>
          {loaderModal}
        </>
      );
  }
};
