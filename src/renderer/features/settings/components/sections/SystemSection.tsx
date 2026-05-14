import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useDiskSpace,
  useLauncherSettings,
  useOpenPath,
  usePickInstallFolder,
  useRamRange,
  useSetLauncher,
} from '../../hooks';
import { FolderInfoBlock } from '../FolderInfoBlock';
import { RamControl } from '../RamControl';

export const SystemSection = () => {
  const { t } = useTranslation();

  const { settings, isPending: settingsPending } = useLauncherSettings();
  const { range, isPending: rangePending } = useRamRange();
  const { mutate: setLauncherMutate, isPending: isSavingLauncher } = useSetLauncher();
  const { mutate: pickFolder } = usePickInstallFolder();
  const openPath = useOpenPath();
  const { info: diskInfo } = useDiskSpace(settings?.storage.clientsFolder);

  const [pendingRam, setPendingRam] = useState<number | null>(null);
  const savedRam = settings?.memory.allocatedRamMb ?? 0;
  const ramValue = pendingRam ?? savedRam;
  const clientsFolder = settings?.storage.clientsFolder ?? '';

  const settingsReady = settings !== undefined && !settingsPending;
  const ramReady = settingsReady && range !== undefined && !rangePending;

  const handleRamSave = async () => {
    if (pendingRam === null) return;
    await setLauncherMutate({ memory: { allocatedRamMb: pendingRam } });
    setPendingRam(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <RamControl
        value={ramValue}
        onChange={setPendingRam}
        onSave={() => void handleRamSave()}
        saved={savedRam}
        range={range ?? []}
        loading={!ramReady}
        saving={isSavingLauncher}
      />

      <FolderInfoBlock
        folder={diskInfo}
        pathLoading={!settingsReady}
        heading={t('settings.system.clientsFolder')}
        description={t('settings.system.clientsFolderDesc')}
        path={clientsFolder}
        onOpen={() => {
          if (clientsFolder) void openPath(clientsFolder);
        }}
        onChange={() => void pickFolder()}
        showDiskUsage={clientsFolder.length > 0}
      />
    </div>
  );
};
