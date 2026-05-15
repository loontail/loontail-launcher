import { useAppVersion } from '@renderer/features/app';
import { Button } from '@renderer/shared/ui/Button';
import { QUERY_KEY_ROOTS } from '@shared/constants';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Group } from '../Group';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { Row } from '../Row';

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

  const handleClearCache = () => {
    queryClient.removeQueries({
      predicate: (query) => {
        const [first] = query.queryKey;
        return first !== QUERY_KEY_ROOTS.auth;
      },
    });
  };

  const handleCheckUpdates = () => {
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
        <Row label={t('settings.launcher.version')} right={<VersionRow />} />
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
