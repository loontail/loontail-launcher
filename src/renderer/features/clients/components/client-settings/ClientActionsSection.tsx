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

type ClientActionsState = {
  repairActive: boolean;
  repairDisabled: boolean;
  uninstallDisabled: boolean;
};

export const selectClientActionsState = (input: {
  status: InstallStatus;
  repairPending: boolean;
  uninstallPending: boolean;
}): ClientActionsState => {
  const repairActive = input.status === InstallStatuses.REPAIRING;
  const canMutateInstall = input.status === InstallStatuses.INSTALLED;
  // Repair runs to completion — while it is active the action is just disabled,
  // there is no cancel affordance.
  return {
    repairActive,
    repairDisabled: repairActive || !canMutateInstall || input.repairPending,
    uninstallDisabled: !canMutateInstall || input.uninstallPending,
  };
};

export const ClientActionsSection = ({
  status,
  repairPending,
  uninstallPending,
  onRepair,
  onRequestUninstall,
}: ClientActionsSectionProps) => {
  const { t } = useTranslation();
  const actionsState = selectClientActionsState({ status, repairPending, uninstallPending });
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
            variant="outline"
            size="sm"
            disabled={actionsState.repairDisabled}
            onClick={onRepair}
          >
            <RotateCcw className="size-3.5" strokeWidth={2} />
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
