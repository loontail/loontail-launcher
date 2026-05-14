import { useTranslation } from 'react-i18next';
import { useLauncherSettings, useSetLauncher } from '../../hooks';
import { Group } from '../Group';
import { SwitchRow } from '../Row';

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
    <Group title={t('settings.game.launch')}>
      <SwitchRow
        label={t('settings.game.console')}
        description={t('settings.game.consoleDesc')}
        checked={launchConsole}
        onCheckedChange={(value) => void handleToggle('console', value)}
        disabled={isPending}
      />
      <SwitchRow
        label={t('settings.game.fullscreen')}
        description={t('settings.game.fullscreenDesc')}
        checked={launchFullscreen}
        onCheckedChange={(value) => void handleToggle('fullscreen', value)}
        disabled={isPending}
      />
    </Group>
  );
};
