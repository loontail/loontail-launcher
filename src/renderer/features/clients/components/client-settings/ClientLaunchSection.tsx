import { OverrideMark } from '@renderer/shared/ui/OverrideMark';
import { SettingsGroup } from '@renderer/shared/ui/SettingsGroup';
import { SettingsSwitchRow } from '@renderer/shared/ui/SettingsRow';
import type { LaunchSettings } from '@shared/contracts/settings';
import { useTranslation } from 'react-i18next';

type ClientLaunchSectionProps = {
  launch: LaunchSettings;
  consoleOverridden: boolean;
  fullscreenOverridden: boolean;
  onToggleConsole: (value: boolean) => void;
  onToggleFullscreen: (value: boolean) => void;
};

export const ClientLaunchSection = ({
  launch,
  consoleOverridden,
  fullscreenOverridden,
  onToggleConsole,
  onToggleFullscreen,
}: ClientLaunchSectionProps) => {
  const { t } = useTranslation();

  return (
    <SettingsGroup title={t('settings.game.launch')}>
      <SettingsSwitchRow
        label={
          <>
            {t('settings.game.console')}
            <OverrideMark shown={consoleOverridden} />
          </>
        }
        description={t('settings.game.consoleDesc')}
        checked={launch.console}
        onCheckedChange={onToggleConsole}
      />
      <SettingsSwitchRow
        label={
          <>
            {t('settings.game.fullscreen')}
            <OverrideMark shown={fullscreenOverridden} />
          </>
        }
        description={t('settings.game.fullscreenDesc')}
        checked={launch.fullscreen}
        onCheckedChange={onToggleFullscreen}
      />
    </SettingsGroup>
  );
};
