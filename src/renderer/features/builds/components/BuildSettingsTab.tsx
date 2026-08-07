import { useDeleteBuild } from '@renderer/features/catalog';
import { useClientStatus, useRepairClient, useUninstallClient } from '@renderer/features/minecraft';
import {
  FolderInfoBlock,
  RamControl,
  useDiskSpace,
  useFolderSize,
  useLauncherSettings,
  useRamRange,
  useResolveFor,
} from '@renderer/features/settings';
import { Button } from '@renderer/shared/ui/Button';
import { type CatalogItem, type LocalCatalogItem, SourceKinds } from '@shared/contracts/catalog';
import type { CatalogKey } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import type { LauncherSettings, ResolvedClientSettings } from '@shared/contracts/settings';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BuildActionsSection } from './build-settings/BuildActionsSection';
import { BuildLaunchSection } from './build-settings/BuildLaunchSection';
import { BuildLoaderSection } from './build-settings/BuildLoaderSection';
import { BuildRuntimeSection } from './build-settings/BuildRuntimeSection';
import { UninstallConfirmModal } from './build-settings/UninstallConfirmModal';
import { useBuildSettingsActions } from './useBuildSettingsActions';

type BuildSettingsTabProps = {
  item: CatalogItem;
  onBuildDeleted: () => void;
};

export const BuildSettingsTab = ({ item, onBuildDeleted }: BuildSettingsTabProps) => {
  const key = item.key;
  const { settings, isPending: settingsPending } = useLauncherSettings();
  const resolved = useResolveFor(key);

  if (!resolved || !settings) return null;

  return (
    <BuildSettingsTabContent
      item={item}
      key={key}
      resolved={resolved}
      settings={settings}
      settingsPending={settingsPending}
      onBuildDeleted={onBuildDeleted}
    />
  );
};

type ContentProps = {
  item: CatalogItem;
  key: CatalogKey;
  resolved: ResolvedClientSettings;
  settings: LauncherSettings;
  settingsPending: boolean;
  onBuildDeleted: () => void;
};

const DeleteBuildSection = ({
  item,
  disabled,
  onDeleted,
}: {
  item: LocalCatalogItem;
  disabled: boolean;
  onDeleted: () => void;
}) => {
  const { t } = useTranslation();
  const deleteBuild = useDeleteBuild();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-edge-lg bg-surface-1 px-4 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-caption font-semibold text-text-hi">
          {t('buildSettings.deleteBuild')}
        </span>
        <span className="text-eyebrow text-text-mute">{t('buildSettings.deleteBuildDesc')}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 border-edge-lg hover:border-edge-xl"
        disabled={disabled || deleteBuild.isPending}
        onClick={() => setConfirmOpen(true)}
      >
        <Trash2 className="size-3.5" strokeWidth={2} />
        {t('buildSettings.deleteBuild')}
      </Button>
      <UninstallConfirmModal
        isOpen={confirmOpen}
        clientTitle={item.presentation.title}
        title={t('buildSettings.deleteConfirmTitle')}
        message={t('buildSettings.deleteConfirm', { name: item.presentation.title })}
        confirmLabel={t('buildSettings.deleteBuild')}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void deleteBuild.mutateAsync(item.ref.id).then(onDeleted);
        }}
      />
    </div>
  );
};

const BuildSettingsTabContent = ({
  item,
  key,
  resolved,
  settings,
  settingsPending,
  onBuildDeleted,
}: ContentProps) => {
  const { t } = useTranslation();
  const { range, isPending: rangePending } = useRamRange();
  const { info: diskInfo, isPending: diskInfoPending } = useDiskSpace(
    resolved.storage.clientFolder,
  );
  const { info: folderSize, isPending: folderSizePending } = useFolderSize(
    resolved.storage.clientFolder,
  );
  const installState = useClientStatus(key);
  const repairMutation = useRepairClient();
  const uninstallMutation = useUninstallClient();
  const [confirmUninstallOpen, setConfirmUninstallOpen] = useState(false);

  const actions = useBuildSettingsActions({ key, resolved, resetKey: key });

  const title = item.presentation.title;
  const ramReady = !settingsPending && !rangePending && range !== undefined;
  const loaderOverridden = settings.clients[key]?.loader !== undefined;
  const hasAnyOverride = Object.values(resolved.diff).some(Boolean) || loaderOverridden;
  const expectedRuntimeComponent = item.spec.runtimeVersion?.trim() || null;
  const currentRuntime =
    installState.status === InstallStatuses.INSTALLED &&
    resolved.runtime &&
    (expectedRuntimeComponent === null || resolved.runtime.component === expectedRuntimeComponent)
      ? resolved.runtime
      : null;
  const isBusy =
    installState.status === InstallStatuses.REPAIRING ||
    installState.status === InstallStatuses.UNINSTALLING ||
    installState.status === InstallStatuses.INSTALLING ||
    installState.status === InstallStatuses.LAUNCHING ||
    installState.status === InstallStatuses.RUNNING;

  return (
    <div className="flex flex-col gap-4">
      <RamControl
        value={actions.ram.ramValue}
        onChange={actions.ram.setRam}
        onSave={() => void actions.ram.handleSave()}
        saved={resolved.memory.allocatedRamMb}
        range={range ?? []}
        loading={!ramReady}
        saving={actions.isSavingOverride}
        overridden={resolved.diff.ram}
      />

      <FolderInfoBlock
        folder={diskInfo}
        diskInfoPending={diskInfoPending}
        folderSize={folderSize}
        folderSizeLoading={folderSizePending}
        pathLoading={settingsPending}
        heading={t('buildSettings.buildFolder')}
        description={t('buildSettings.buildFolderDesc')}
        path={resolved.storage.clientFolder}
        onOpen={actions.openFolder}
        onChange={actions.changeFolder}
        openLabel={t('buildSettings.openFolder')}
        changeLabel={t('buildSettings.changeFolder')}
        overridden={resolved.diff.folder}
      />

      <BuildLaunchSection
        launch={resolved.launch}
        consoleOverridden={resolved.diff.console}
        fullscreenOverridden={resolved.diff.fullscreen}
        onToggleConsole={actions.toggleConsole}
        onToggleFullscreen={actions.toggleFullscreen}
      />

      <BuildLoaderSection
        spec={item.spec}
        loader={resolved.loader}
        loaderOverridden={loaderOverridden}
        isSavingOverride={actions.isSavingOverride}
        onSwitchLoader={actions.setLoader}
      />

      {currentRuntime && <BuildRuntimeSection runtime={currentRuntime} />}

      <BuildActionsSection
        status={installState.status}
        repairPending={repairMutation.isPending}
        uninstallPending={uninstallMutation.isPending}
        onRepair={() => void repairMutation.mutateAsync(key)}
        onRequestUninstall={() => setConfirmUninstallOpen(true)}
      />

      {item.kind === SourceKinds.LOCAL && (
        <DeleteBuildSection item={item} disabled={isBusy} onDeleted={onBuildDeleted} />
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-eyebrow text-text-mute">{t('buildSettings.footnote')}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void actions.resetAll()}
          disabled={!hasAnyOverride}
        >
          {t('buildSettings.resetAll')}
        </Button>
      </div>

      <UninstallConfirmModal
        isOpen={confirmUninstallOpen}
        clientTitle={title}
        onClose={() => setConfirmUninstallOpen(false)}
        onConfirm={() => {
          setConfirmUninstallOpen(false);
          void uninstallMutation.mutateAsync(key);
        }}
      />
    </div>
  );
};
