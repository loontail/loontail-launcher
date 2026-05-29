import { Button } from '@renderer/shared/ui/Button';
import { SettingsGroup } from '@renderer/shared/ui/SettingsGroup';
import { SettingsRow } from '@renderer/shared/ui/SettingsRow';
import { type InstallStatus, InstallStatuses } from '@shared/contracts/minecraft';
import { Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type ClientActionsSectionProps = {
  status: InstallStatus;
  repairPending: boolean;
  cancelPending: boolean;
  uninstallPending: boolean;
  onRepair: () => void;
  onCancel: () => void;
  onRequestUninstall: () => void;
};

type ClientActionsState = {
  repairActive: boolean;
  repairDisabled: boolean;
  uninstallDisabled: boolean;
};

export const selectClientActionsState = (input: {
  status: InstallStatus;
  repairPending: boolean;
  cancelPending: boolean;
  uninstallPending: boolean;
}): ClientActionsState => {
  const repairActive = input.status === InstallStatuses.REPAIRING;
  const canMutateInstall = input.status === InstallStatuses.INSTALLED;
  return {
    repairActive,
    repairDisabled: repairActive ? input.cancelPending : !canMutateInstall || input.repairPending,
    uninstallDisabled: !canMutateInstall || input.uninstallPending,
  };
};

export const ClientActionsSection = ({
  status,
  repairPending,
  cancelPending,
  uninstallPending,
  onRepair,
  onCancel,
  onRequestUninstall,
}: ClientActionsSectionProps) => {
  const { t } = useTranslation();
  const actionsState = selectClientActionsState({
    status,
    repairPending,
    cancelPending,
    uninstallPending,
  });
  const repairLabel = actionsState.repairActive ? (
    <span className="inline-flex items-center gap-2">
      <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
      {t('clients.installSteps.header.repair')}
    </span>
  ) : (
    t('clientSettings.repair')
  );

  return (
    <SettingsGroup title={t('clientSettings.actions')}>
      <SettingsRow
        label={repairLabel}
        description={t('clientSettings.repairDesc')}
        right={
          <Button
            variant={actionsState.repairActive ? 'destructive' : 'outline'}
            size="sm"
            disabled={actionsState.repairDisabled}
            onClick={actionsState.repairActive ? onCancel : onRepair}
          >
            {actionsState.repairActive ? (
              <X className="size-3.5" strokeWidth={2} />
            ) : (
              <RotateCcw className="size-3.5" strokeWidth={2} />
            )}
            {actionsState.repairActive ? t('clients.cancel') : t('clientSettings.repair')}
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
            disabled={actionsState.uninstallDisabled}
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
