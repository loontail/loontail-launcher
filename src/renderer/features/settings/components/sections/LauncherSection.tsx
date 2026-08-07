import { useAppVersion } from '@renderer/features/app';
import { useClearMediaCache, useMediaCacheSize } from '@renderer/features/settings';
import {
  markUserInitiatedCheck,
  triggerInstall,
  triggerUpdaterCheck,
  useUpdaterStatus,
} from '@renderer/features/updater';
import { Button } from '@renderer/shared/ui/Button';
import { SettingsGroup } from '@renderer/shared/ui/SettingsGroup';
import { SettingsRow } from '@renderer/shared/ui/SettingsRow';
import { UpdaterStates } from '@shared/contracts/updater';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { clearLauncherCache } from '../../clearCache';
import { formatBytes } from '../../lib/formatBytes';
import { LanguageSwitcher } from '../LanguageSwitcher';

const formatCacheSize = (bytes: number | undefined): string =>
  formatBytes(bytes, { placeholder: '…', maxUnit: 'mb' });

const VersionRow = () => {
  const versionQuery = useAppVersion();
  return (
    <span className="text-sm text-text-mute">
      {versionQuery.isPending ? '…' : (versionQuery.data ?? 'unknown')}
    </span>
  );
};

export const LauncherSection = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const updateStatus = useUpdaterStatus();
  const { bytes: cacheBytes } = useMediaCacheSize();
  // clearLauncherCache awaits this and downgrades a failure to a warning toast.
  const { mutateAsync: clearMediaCache, isPending: isClearingCache } = useClearMediaCache();
  const isReady = updateStatus?.state === UpdaterStates.READY;
  const isBusy =
    updateStatus?.state === UpdaterStates.CHECKING ||
    updateStatus?.state === UpdaterStates.AVAILABLE;

  const handleClearCache = () => clearLauncherCache(queryClient, clearMediaCache, t);

  const handleCheckUpdates = () => {
    markUserInitiatedCheck();
    triggerUpdaterCheck();
  };

  const handleInstall = () => {
    triggerInstall();
  };

  return (
    <div className="flex flex-col gap-5">
      <SettingsGroup title={t('settings.launcher.maintenance')}>
        <SettingsRow
          label={t('settings.launcher.clearCache')}
          description={t('settings.launcher.clearCacheDesc', { size: formatCacheSize(cacheBytes) })}
          right={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleClearCache()}
              disabled={isClearingCache}
              aria-busy={isClearingCache}
            >
              {isClearingCache ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                t('settings.launcher.clear')
              )}
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
