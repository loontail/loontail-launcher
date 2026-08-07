import { useTranslation } from 'react-i18next';
import {
  useDiskSpace,
  useFolderSize,
  useLauncherSettings,
  usePickInstallFolder,
  useRamRange,
  useSetLauncher,
} from '../../hooks';
import { useRamPending } from '../../hooks/useRamPending';
import { openPath } from '../../systemApi';
import { FolderInfoBlock } from '../FolderInfoBlock';
import { RamControl } from '../RamControl';

export const SystemSection = () => {
  const { t } = useTranslation();

  const { settings, isPending: settingsPending } = useLauncherSettings();
  const { range, isPending: rangePending } = useRamRange();
  const { mutateAsync: saveLauncher, isPending: isSavingLauncher } = useSetLauncher();
  const { mutate: pickFolder } = usePickInstallFolder();
  const { info: diskInfo, isPending: diskInfoPending } = useDiskSpace(
    settings?.storage.clientsFolder,
  );
  const { info: folderSize, isPending: folderSizePending } = useFolderSize(
    settings?.storage.clientsFolder,
  );

  const savedRam = settings?.memory.allocatedRamMb ?? 0;
  const clientsFolder = settings?.storage.clientsFolder ?? '';

  const { ramValue, setRam, handleSave } = useRamPending({
    savedRam,
    resetKey: savedRam,
    persist: (allocatedRamMb) => saveLauncher({ memory: { allocatedRamMb } }),
  });

  const settingsReady = settings !== undefined && !settingsPending;
  const ramReady = settingsReady && range !== undefined && !rangePending;

  return (
    <div className="flex flex-col gap-4">
      <RamControl
        value={ramValue}
        onChange={setRam}
        onSave={() => void handleSave()}
        saved={savedRam}
        range={range ?? []}
        loading={!ramReady}
        saving={isSavingLauncher}
      />

      <FolderInfoBlock
        folder={diskInfo}
        diskInfoPending={diskInfoPending}
        folderSize={folderSize}
        folderSizeLoading={folderSizePending}
        pathLoading={!settingsReady}
        heading={t('settings.system.clientsFolder')}
        description={t('settings.system.clientsFolderDesc')}
        path={clientsFolder}
        onOpen={() => {
          if (clientsFolder) void openPath(clientsFolder);
        }}
        onChange={() => pickFolder()}
      />
    </div>
  );
};
