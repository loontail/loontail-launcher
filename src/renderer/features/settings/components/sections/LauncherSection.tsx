import { Button } from '@renderer/shared/ui/Button';
import { IPC_CHANNELS } from '@shared/ipc';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Group } from '../Group';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { Row } from '../Row';

const VersionRow = (): ReactElement => {
  const versionQuery = useQuery({
    queryKey: ['app', 'version'],
    queryFn: () => window.api.invoke(IPC_CHANNELS.appGetVersion, undefined),
  });
  return (
    <span className="text-sm text-muted-foreground">
      {versionQuery.isPending ? '…' : (versionQuery.data ?? 'unknown')}
    </span>
  );
};

export const LauncherSection = (): ReactElement => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const handleClearCache = (): void => {
    queryClient.removeQueries({
      predicate: (query) => {
        const [first] = query.queryKey;
        return first !== 'auth';
      },
    });
  };

  const handleCheckUpdates = (): void => {
    // TODO(updater): wire to electron-updater when the auto-update flow lands.
  };

  return (
    <div className="flex flex-col gap-5">
      <Group title={t('settings.launcher.maintenance')}>
        <Row
          label={t('settings.launcher.clearCache')}
          description={t('settings.launcher.clearCacheDesc')}
          right={
            <Button variant="outline" size="sm" onClick={handleClearCache}>
              {t('settings.launcher.clear')}
            </Button>
          }
        />
        <Row
          label={t('settings.launcher.updates')}
          description={t('settings.launcher.updatesDesc')}
          right={
            <Button variant="outline" size="sm" onClick={handleCheckUpdates}>
              {t('settings.launcher.check')}
            </Button>
          }
        />
        <Row label="Version" right={<VersionRow />} />
      </Group>

      <Group title={t('settings.launcher.interface')}>
        <Row
          label={t('settings.launcher.language')}
          description={t('settings.launcher.languageDesc')}
          right={<LanguageSwitcher />}
        />
      </Group>
    </div>
  );
};
