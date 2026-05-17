import { useAppVersion } from '@renderer/features/app';
import { useUpdaterStatus } from '@renderer/features/updater';
import { Button } from '@renderer/shared/ui/Button';
import { SettingsGroup } from '@renderer/shared/ui/SettingsGroup';
import { SettingsRow } from '@renderer/shared/ui/SettingsRow';
import { toast } from '@renderer/shared/ui/Toast';
import { QUERY_KEY_ROOTS } from '@shared/constants';
import { UpdaterStates, type UpdaterStatusEvent } from '@shared/contracts/updater';
import { IPC_CHANNELS } from '@shared/ipc';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../LanguageSwitcher';

const VersionRow = () => {
  const versionQuery = useAppVersion();
  return (
    <span className="text-sm text-muted-foreground">
      {versionQuery.isPending ? '…' : (versionQuery.data ?? 'unknown')}
    </span>
  );
};

const UpdateStatusLabel = ({ status }: { status: UpdaterStatusEvent | null }) => {
  const { t } = useTranslation();
  if (!status) return null;
  switch (status.state) {
    case UpdaterStates.CHECKING:
      return (
        <span className="text-[11px] text-muted-foreground">{t('settings.launcher.checking')}</span>
      );
    case UpdaterStates.AVAILABLE:
      return (
        <span className="text-[11px] text-success">
          {t('settings.launcher.available', { version: status.version })}
        </span>
      );
    case UpdaterStates.NOT_AVAILABLE:
      return null;
    case UpdaterStates.DOWNLOADING:
      return (
        <span className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          <span>{t('settings.launcher.downloading', { percent: Math.round(status.percent) })}</span>
          <span
            className="relative h-1 w-40 overflow-hidden rounded-full bg-glass/15"
            role="progressbar"
            tabIndex={-1}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(status.percent)}
          >
            <span
              className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-150"
              style={{ width: `${Math.max(0, Math.min(100, status.percent))}%` }}
            />
          </span>
        </span>
      );
    case UpdaterStates.READY:
      return (
        <span className="text-[11px] text-success">
          {t('settings.launcher.ready', { version: status.version })}
        </span>
      );
    case UpdaterStates.ERROR:
      return (
        <span className="text-[11px] text-destructive">
          {t('settings.launcher.updateError', { message: status.message })}
        </span>
      );
    default:
      return null;
  }
};

const isReady = (status: UpdaterStatusEvent | null): boolean =>
  status?.state === UpdaterStates.READY;

export const LauncherSection = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const updateStatus = useUpdaterStatus();
  const [checking, setChecking] = useState(false);
  // Tracks whether this component just initiated a check, so we can fire the
  // "Up to date" / "Available" / "Error" toast only on user-requested checks
  // (not background events that flow through the global status store).
  const userCheckRequestedRef = useRef(false);

  useEffect(() => {
    if (!updateStatus) return;
    if (updateStatus.state !== UpdaterStates.CHECKING) setChecking(false);
    if (!userCheckRequestedRef.current) return;
    switch (updateStatus.state) {
      case UpdaterStates.NOT_AVAILABLE:
        toast.info(t('settings.launcher.notAvailable'));
        userCheckRequestedRef.current = false;
        return;
      case UpdaterStates.AVAILABLE:
        toast.success(t('settings.launcher.available', { version: updateStatus.version }));
        userCheckRequestedRef.current = false;
        return;
      case UpdaterStates.READY:
        toast.success(t('settings.launcher.ready', { version: updateStatus.version }));
        userCheckRequestedRef.current = false;
        return;
      case UpdaterStates.ERROR:
        toast.error(t('settings.launcher.updateError', { message: updateStatus.message }));
        userCheckRequestedRef.current = false;
        return;
    }
  }, [updateStatus, t]);

  const handleClearCache = () => {
    queryClient.removeQueries({
      predicate: (query) => {
        const [first] = query.queryKey;
        return first !== QUERY_KEY_ROOTS.auth;
      },
    });
    toast.success(t('settings.launcher.cacheClearedToast'));
  };

  const handleCheckUpdates = async () => {
    setChecking(true);
    userCheckRequestedRef.current = true;
    try {
      await window.api.invoke(IPC_CHANNELS.updaterCheck, undefined);
    } catch {
      setChecking(false);
      userCheckRequestedRef.current = false;
    }
  };

  const handleInstall = () => {
    void window.api.invoke(IPC_CHANNELS.updaterInstall, undefined);
  };

  return (
    <div className="flex flex-col gap-5">
      <SettingsGroup title={t('settings.launcher.maintenance')}>
        <SettingsRow
          label={t('settings.launcher.clearCache')}
          description={t('settings.launcher.clearCacheDesc')}
          right={
            <Button variant="outline" size="sm" onClick={handleClearCache}>
              {t('settings.launcher.clear')}
            </Button>
          }
        />
        <SettingsRow
          label={t('settings.launcher.updates')}
          description={
            <span className="flex flex-col gap-0.5">
              <span>{t('settings.launcher.updatesDesc')}</span>
              <UpdateStatusLabel status={updateStatus} />
            </span>
          }
          right={
            isReady(updateStatus) ? (
              <Button size="sm" onClick={handleInstall}>
                {t('settings.launcher.restartNow')}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleCheckUpdates()}
                disabled={checking}
              >
                {t('settings.launcher.check')}
              </Button>
            )
          }
        />
        <SettingsRow label={t('settings.launcher.version')} right={<VersionRow />} />
      </SettingsGroup>

      <SettingsGroup title={t('settings.launcher.interface')}>
        <SettingsRow
          label={t('settings.launcher.language')}
          description={t('settings.launcher.languageDesc')}
          right={<LanguageSwitcher />}
        />
      </SettingsGroup>
    </div>
  );
};
