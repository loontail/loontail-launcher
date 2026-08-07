import { Button } from '@renderer/shared/ui/Button';
import { SettingsGroup } from '@renderer/shared/ui/SettingsGroup';
import { SettingsRow } from '@renderer/shared/ui/SettingsRow';
import { type InstallStatus, InstallStatuses } from '@shared/contracts/minecraft';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type BuildActionsSectionProps = {
  status: InstallStatus;
  repairPending: boolean;
  uninstallPending: boolean;
  onRepair: () => void;
  onRequestUninstall: () => void;
};

type BuildActionsState = {
  repairActive: boolean;
  repairDisabled: boolean;
  uninstallDisabled: boolean;
};

export const selectBuildActionsState = (input: {
  status: InstallStatus;
  repairPending: boolean;
  uninstallPending: boolean;
}): BuildActionsState => {
  const repairActive = input.status === InstallStatuses.REPAIRING;
  const canMutateInstall = input.status === InstallStatuses.INSTALLED;
  // Repair is not cancellable; it can only be disabled while running.
  return {
    repairActive,
    repairDisabled: repairActive || !canMutateInstall || input.repairPending,
    uninstallDisabled: !canMutateInstall || input.uninstallPending,
  };
};

export const BuildActionsSection = ({
  status,
  repairPending,
  uninstallPending,
  onRepair,
  onRequestUninstall,
}: BuildActionsSectionProps) => {
  const { t } = useTranslation();
  const actionsState = selectBuildActionsState({ status, repairPending, uninstallPending });
  const repairLabel = actionsState.repairActive ? (
    <span className="inline-flex items-center gap-2">
      <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
      {t('builds.installSteps.header.repair')}
    </span>
  ) : (
    t('buildSettings.repair')
  );

  return (
    <SettingsGroup title={t('buildSettings.actions')}>
      <SettingsRow
        label={repairLabel}
        description={t('buildSettings.repairDesc')}
        right={
          <Button
            variant="outline"
            size="sm"
            disabled={actionsState.repairDisabled}
            onClick={onRepair}
          >
            <RotateCcw className="size-3.5" strokeWidth={2} />
            {t('buildSettings.repair')}
          </Button>
        }
      />
      <SettingsRow
        label={t('buildSettings.uninstall')}
        description={t('buildSettings.uninstallDesc')}
        right={
          <Button
            variant="destructive"
            size="sm"
            disabled={actionsState.uninstallDisabled}
            onClick={onRequestUninstall}
          >
            <Trash2 className="size-3.5" strokeWidth={2} />
            {t('buildSettings.uninstall')}
          </Button>
        }
      />
    </SettingsGroup>
  );
};
