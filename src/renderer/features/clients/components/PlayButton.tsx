import {
  isBundleBusy,
  localizeBundleError,
  useBundleStatus,
  useCancelBundle,
  usePauseBundle,
  useResumeBundle,
  useStartBundle,
} from '@renderer/features/bundle';
import {
  localizeMinecraftError,
  useCancelInstall,
  useClientStatus,
  useInstallClient,
  useLaunchClient,
  usePauseInstall,
  useResumeInstall,
  useStopClient,
} from '@renderer/features/minecraft';
import { useLauncherSettings, useResolveFor } from '@renderer/features/settings';
import { cn } from '@renderer/shared/lib/cn';
import { BundleSyncStatuses } from '@shared/contracts/bundle';
import type { Client } from '@shared/contracts/client';
import { InstallStatuses, type ProgressStage, ProgressStages } from '@shared/contracts/minecraft';
import type { LoaderChoice } from '@shared/contracts/settings';
import { isLoaderAvailable } from '@shared/domain/loader';
import { Download, Loader2, Pause, Play, RotateCcw, Square, X } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode, forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderChoiceModal } from './LoaderChoiceModal';

type ActionVariant = 'primary' | 'ghost' | 'danger';

type ActionBtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ActionVariant };

const VARIANT_CLASSES: Record<ActionVariant, string> = {
  primary:
    'h-12 min-w-[140px] px-7 text-[14px] tracking-wide bg-primary text-primary-foreground ' +
    'shadow-[0_8px_24px_-6px_var(--color-glow-overlay-md)] ' +
    'hover:scale-[1.02] hover:shadow-[0_10px_28px_-6px_var(--color-glow-overlay-lg)] active:scale-[0.97]',
  ghost:
    'h-9 px-4 text-[12px] border border-edge-md bg-ghost text-glass/75 ' +
    'hover:border-edge-xl hover:bg-ghost-hover hover:text-glass active:scale-[0.97]',
  danger:
    'h-9 px-4 text-[12px] border border-destructive/30 bg-destructive/10 text-destructive/85 ' +
    'hover:border-destructive/40 hover:bg-destructive/15 hover:text-destructive active:scale-[0.97]',
};

const ActionBtn = forwardRef<HTMLButtonElement, ActionBtnProps>(
  ({ className, variant = 'primary', type = 'button', children, ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-bold transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/40 focus-visible:ring-offset-0',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  ),
);
ActionBtn.displayName = 'ActionBtn';

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return '0 B';
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), SIZE_UNITS.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${SIZE_UNITS[unit]}`;
};

const STAGE_LABEL_KEY: Record<ProgressStage, string> = {
  [ProgressStages.PREPARE]: 'clients.stage.prepare',
  [ProgressStages.RUNTIME]: 'clients.stage.runtime',
  [ProgressStages.MINECRAFT]: 'clients.stage.minecraft',
  [ProgressStages.LOADER]: 'clients.stage.loader',
  [ProgressStages.FINALIZE]: 'clients.stage.finalize',
};

type ProgressCardProps = {
  stageLabel: string;
  currentFile?: string | undefined;
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
  controls?: ReactNode | undefined;
};

const ProgressCard = ({
  stageLabel,
  currentFile,
  percent,
  bytesDownloaded,
  totalBytes,
  controls,
}: ProgressCardProps) => {
  const percentRounded = Math.round(percent);
  return (
    <div className="flex w-full max-w-[480px] flex-col gap-3.5 rounded-2xl border border-edge bg-surface p-5 backdrop-blur-md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-glass/55">
            {stageLabel}
          </p>
          <p className="mt-1 truncate text-[12px] text-glass/70" title={currentFile ?? ''}>
            {currentFile ?? ' '}
          </p>
        </div>
        <p className="shrink-0 tabular-nums text-right text-2xl font-bold leading-none text-glass">
          {percentRounded}
          <span className="text-[14px] font-semibold text-glass/55">%</span>
        </p>
      </div>
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-glass/15">
        <div
          className="h-full w-full bg-primary transition-transform duration-150"
          style={{ transform: `translateX(-${Math.max(0, Math.min(100, 100 - percent))}%)` }}
        />
      </div>
      {totalBytes > 0 && (
        <div className="flex justify-end tabular-nums text-[11px] text-glass/60">
          <span>
            {formatBytes(bytesDownloaded)} / {formatBytes(totalBytes)}
          </span>
        </div>
      )}
      {controls && <div className="mt-1 flex gap-2">{controls}</div>}
    </div>
  );
};

type PlayButtonProps = { client: Client };

export const PlayButton = ({ client }: PlayButtonProps) => {
  const { t } = useTranslation();
  const slug = client.slug;
  const state = useClientStatus(slug);
  const bundle = useBundleStatus(slug);
  const resolved = useResolveFor(slug);
  const { settings } = useLauncherSettings();

  const install = useInstallClient();
  const pause = usePauseInstall();
  const resume = useResumeInstall();
  const cancel = useCancelInstall();
  const launch = useLaunchClient();
  const stop = useStopClient();
  const startBundle = useStartBundle();
  const pauseBundle = usePauseBundle();
  const resumeBundle = useResumeBundle();
  const cancelBundle = useCancelBundle();
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
  const hasBundle = Boolean(client.bundleSlug);
  const bundleBusy = isBundleBusy(bundle.status);

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

  const stageLabel = state.stage ? t(STAGE_LABEL_KEY[state.stage]) : t('clients.installing');

  // Bundle sync overlays: shown once Minecraft is installed (or idle) and the
  // bundle is actively syncing. Pre-empts the regular Play/Repair surface so
  // the user can see why launch is paused.
  if (
    hasBundle &&
    bundleBusy &&
    state.status !== InstallStatuses.INSTALLING &&
    state.status !== InstallStatuses.REPAIRING
  ) {
    const isPaused = bundle.status === BundleSyncStatuses.PAUSED;
    const total = bundle.progress?.bytesTotal ?? 0;
    const done = bundle.progress?.bytesDownloaded ?? 0;
    const percent = total > 0 ? (done / total) * 100 : 0;
    const bundleStageLabel = isPaused
      ? `${t('clients.stage.bundle')} — ${t('clients.paused')}`
      : t(`clients.bundleStage.${bundle.status}`, { defaultValue: t('clients.stage.bundle') });
    return (
      <ProgressCard
        stageLabel={bundleStageLabel}
        currentFile={bundle.progress?.currentFile}
        percent={percent}
        bytesDownloaded={done}
        totalBytes={total}
        controls={
          <>
            {isPaused ? (
              <ActionBtn variant="ghost" onClick={() => void resumeBundle.mutateAsync(slug)}>
                <Play size={12} />
                {t('clients.resume')}
              </ActionBtn>
            ) : (
              <ActionBtn variant="ghost" onClick={() => void pauseBundle.mutateAsync(slug)}>
                <Pause size={12} />
                {t('clients.pause')}
              </ActionBtn>
            )}
            <ActionBtn variant="danger" onClick={() => void cancelBundle.mutateAsync(slug)}>
              <X size={12} />
              {t('clients.cancel')}
            </ActionBtn>
          </>
        }
      />
    );
  }

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

  switch (state.status) {
    case InstallStatuses.INSTALLING:
      return (
        <>
          <ProgressCard
            stageLabel={state.paused ? `${stageLabel} — ${t('clients.paused')}` : stageLabel}
            currentFile={state.currentFile}
            percent={state.overallPercent ?? 0}
            bytesDownloaded={state.bytesDownloaded ?? 0}
            totalBytes={state.totalBytes ?? 0}
            controls={
              <>
                {state.paused ? (
                  <ActionBtn variant="ghost" onClick={() => void resume.mutateAsync(slug)}>
                    <Play size={12} />
                    {t('clients.resume')}
                  </ActionBtn>
                ) : (
                  <ActionBtn variant="ghost" onClick={() => void pause.mutateAsync(slug)}>
                    <Pause size={12} />
                    {t('clients.pause')}
                  </ActionBtn>
                )}
                <ActionBtn variant="danger" onClick={() => void cancel.mutateAsync(slug)}>
                  <X size={12} />
                  {t('clients.cancel')}
                </ActionBtn>
              </>
            }
          />
          {loaderModal}
        </>
      );

    case InstallStatuses.REPAIRING:
      return (
        <ProgressCard
          stageLabel={t('clients.repairing')}
          currentFile={state.currentFile}
          percent={state.overallPercent ?? 0}
          bytesDownloaded={state.bytesDownloaded ?? 0}
          totalBytes={state.totalBytes ?? 0}
        />
      );

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
