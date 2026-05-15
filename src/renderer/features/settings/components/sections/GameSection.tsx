import { SettingsGroup } from '@renderer/shared/ui/SettingsGroup';
import { SettingsSwitchRow } from '@renderer/shared/ui/SettingsRow';
import { useTranslation } from 'react-i18next';
import { useLauncherSettings, useSetLauncher } from '../../hooks';

export const GameSection = () => {
  const { t } = useTranslation();
  const { settings, isPending } = useLauncherSettings();
  const { mutate } = useSetLauncher();

  const launchConsole = settings?.launch.console ?? false;
  const launchFullscreen = settings?.launch.fullscreen ?? false;

  const handleToggle = async (key: 'console' | 'fullscreen', value: boolean) => {
    await mutate({ launch: { [key]: value } });
  };

  return (
    <SettingsGroup title={t('settings.game.launch')}>
      <SettingsSwitchRow
        label={t('settings.game.console')}
        description={t('settings.game.consoleDesc')}
        checked={launchConsole}
        onCheckedChange={(value) => void handleToggle('console', value)}
        disabled={isPending}
      />
      <SettingsSwitchRow
        label={t('settings.game.fullscreen')}
        description={t('settings.game.fullscreenDesc')}
        checked={launchFullscreen}
        onCheckedChange={(value) => void handleToggle('fullscreen', value)}
        disabled={isPending}
      />
    </SettingsGroup>
  );
};
