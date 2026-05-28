import { Button } from '@renderer/shared/ui/Button';
import { SettingsGroup } from '@renderer/shared/ui/SettingsGroup';
import { SettingsRow } from '@renderer/shared/ui/SettingsRow';
import { type InstallStatus, InstallStatuses } from '@shared/contracts/minecraft';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type ClientActionsSectionProps = {
  status: InstallStatus;
  repairPending: boolean;
  uninstallPending: boolean;
  onRepair: () => void;
  onRequestUninstall: () => void;
};

export const ClientActionsSection = ({
  status,
  repairPending,
  uninstallPending,
  onRepair,
  onRequestUninstall,
}: ClientActionsSectionProps) => {
  const { t } = useTranslation();
  const canMutateInstall = status === InstallStatuses.INSTALLED;

  return (
    <SettingsGroup title={t('clientSettings.actions')}>
      <SettingsRow
        label={t('clientSettings.repair')}
        description={t('clientSettings.repairDesc')}
        right={
          <Button
            variant="outline"
            size="sm"
            disabled={!canMutateInstall || repairPending}
            onClick={onRepair}
          >
            {status === InstallStatuses.REPAIRING ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <RotateCcw className="size-3.5" strokeWidth={2} />
            )}
            {t('clientSettings.repair')}
          </Button>
        }
      />
      <SettingsRow
        label={t('clientSettings.uninstall')}
        description={t('clientSettings.uninstallDesc')}
        right={
          <Button
            variant="destructive"
            size="sm"
            disabled={!canMutateInstall || uninstallPending}
            onClick={onRequestUninstall}
          >
            <Trash2 className="size-3.5" strokeWidth={2} />
            {t('clientSettings.uninstall')}
          </Button>
        }
      />
    </SettingsGroup>
  );
};
