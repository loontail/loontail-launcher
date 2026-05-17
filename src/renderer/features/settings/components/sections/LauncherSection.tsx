import { useAppVersion } from '@renderer/features/app';
import {
  markUserInitiatedCheck,
  triggerUpdaterCheck,
  useUpdaterStatus,
} from '@renderer/features/updater';
import { Button } from '@renderer/shared/ui/Button';
import { SettingsGroup } from '@renderer/shared/ui/SettingsGroup';
import { SettingsRow } from '@renderer/shared/ui/SettingsRow';
import { toast } from '@renderer/shared/ui/Toast';
import { QUERY_KEY_ROOTS } from '@shared/constants';
import { UpdaterStates } from '@shared/contracts/updater';
import { IPC_CHANNELS } from '@shared/ipc';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
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

export const LauncherSection = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const updateStatus = useUpdaterStatus();
  const isReady = updateStatus?.state === UpdaterStates.READY;
  const isBusy =
    updateStatus?.state === UpdaterStates.CHECKING ||
    updateStatus?.state === UpdaterStates.AVAILABLE ||
    updateStatus?.state === UpdaterStates.DOWNLOADING;

  const handleClearCache = () => {
    queryClient.removeQueries({
      predicate: (query) => {
        const [first] = query.queryKey;
        return first !== QUERY_KEY_ROOTS.auth;
      },
    });
    toast.success(t('settings.launcher.cacheClearedToast'));
  };

  const handleCheckUpdates = () => {
    markUserInitiatedCheck();
    triggerUpdaterCheck();
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
          description={t('settings.launcher.updatesDesc')}
          right={
            isReady ? (
              <Button size="sm" onClick={handleInstall}>
                {t('settings.launcher.restartNow')}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCheckUpdates}
                disabled={isBusy}
                aria-busy={isBusy}
              >
                {isBusy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  t('settings.launcher.check')
                )}
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
