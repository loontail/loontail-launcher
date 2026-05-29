import {
  useCancelInstall,
  useClientStatus,
  useRepairClient,
  useUninstallClient,
} from '@renderer/features/minecraft';
import {
  FolderInfoBlock,
  RamControl,
  openPath,
  useChooseClientFolder,
  useClearClientOverrides,
  useDiskSpace,
  useFolderSize,
  useLauncherSettings,
  useRamRange,
  useResolveFor,
  useSetClientOverride,
} from '@renderer/features/settings';
import { Button } from '@renderer/shared/ui/Button';
import { Modal } from '@renderer/shared/ui/Modal';
import type { Client } from '@shared/contracts/client';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClientActionsSection } from './client-settings/ClientActionsSection';
import { ClientLaunchSection } from './client-settings/ClientLaunchSection';
import { ClientLoaderSection } from './client-settings/ClientLoaderSection';
import { ClientRuntimeSection } from './client-settings/ClientRuntimeSection';
import { UninstallConfirmModal } from './client-settings/UninstallConfirmModal';

type ClientSettingsModalProps = {
  isOpen: boolean;
  client: Client | null;
  onClose: () => void;
};

export const ClientSettingsModal = ({ isOpen, client, onClose }: ClientSettingsModalProps) => {
  const { t } = useTranslation();
  const slug = client?.slug ?? null;

  const { settings, isPending: settingsPending } = useLauncherSettings();
  const resolved = useResolveFor(slug);
  const { range, isPending: rangePending } = useRamRange();
  const { info: diskInfo } = useDiskSpace(resolved?.storage.clientFolder);
  const { info: folderSize, isPending: folderSizePending } = useFolderSize(
    resolved?.storage.clientFolder,
  );
  const { mutate: setClientOverride, isPending: isSavingOverride } = useSetClientOverride();
  const { mutate: clearClientOverrides } = useClearClientOverrides();
  const { mutate: chooseClientFolder } = useChooseClientFolder();
  const runtimeState = useClientStatus(slug);
  const repairMutation = useRepairClient();
  const cancelMutation = useCancelInstall();
  const uninstallMutation = useUninstallClient();
  const [confirmUninstallOpen, setConfirmUninstallOpen] = useState(false);

  const savedRam = resolved?.memory.allocatedRamMb ?? 0;
  const [pendingRam, setPendingRam] = useState<number | null>(null);
  const ramValue = pendingRam ?? savedRam;

  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger on modal toggle / client switch — start RAM from fresh resolved value
  useEffect(() => {
    setPendingRam(null);
  }, [isOpen, slug]);

  if (!client || !slug || !resolved || !settings) return null;

  const ramReady = !settingsPending && !rangePending && range !== undefined;

  const handleRamSave = async () => {
    if (pendingRam === null) return;
    await setClientOverride({
      slug,
      patch: { memory: { allocatedRamMb: pendingRam } },
    });
    setPendingRam(null);
  };

  const handleToggleConsole = async (value: boolean) => {
    await setClientOverride({ slug, patch: { launch: { console: value } } });
  };

  const handleToggleFullscreen = async (value: boolean) => {
    await setClientOverride({ slug, patch: { launch: { fullscreen: value } } });
  };

  const handleResetAll = async () => {
    await clearClientOverrides(slug);
    setPendingRam(null);
  };

  const handleChangeFolder = async () => {
    await chooseClientFolder(slug);
  };

  const handleOpenFolder = () => {
    if (resolved.storage.clientFolder) void openPath(resolved.storage.clientFolder);
  };
  const loaderOverridden = settings.clients[slug]?.loader !== undefined;
  const hasAnyOverride = Object.values(resolved.diff).some(Boolean) || loaderOverridden;
  const expectedRuntimeComponent = client.runtimeVersion?.trim() || null;
  const currentRuntime =
    runtimeState.status === InstallStatuses.INSTALLED &&
    resolved.runtime &&
    (expectedRuntimeComponent === null || resolved.runtime.component === expectedRuntimeComponent)
      ? resolved.runtime
      : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      scrollable
      ariaLabel={t('clientSettings.title', { name: client.title })}
      className="max-w-xl"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-base font-semibold text-foreground">
            {t('clientSettings.title', { name: client.title })}
          </h2>
          <p className="text-xs text-muted-foreground">{t('clientSettings.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('clientSettings.close')}
          className="-m-1 flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <RamControl
          value={ramValue}
          onChange={setPendingRam}
          onSave={() => void handleRamSave()}
          saved={savedRam}
          range={range ?? []}
          loading={!ramReady}
          saving={isSavingOverride}
          overridden={resolved.diff.ram}
        />

        <FolderInfoBlock
          folder={diskInfo}
          folderSize={folderSize}
          folderSizeLoading={folderSizePending}
          pathLoading={settingsPending}
          heading={t('clientSettings.clientFolder')}
          description={t('clientSettings.clientFolderDesc')}
          path={resolved.storage.clientFolder}
          onOpen={handleOpenFolder}
          onChange={() => void handleChangeFolder()}
          openLabel={t('clientSettings.openFolder')}
          changeLabel={t('clientSettings.changeFolder')}
          showDiskUsage={resolved.storage.clientFolder.length > 0}
          overridden={resolved.diff.folder}
        />

        <ClientLaunchSection
          launch={resolved.launch}
          consoleOverridden={resolved.diff.console}
          fullscreenOverridden={resolved.diff.fullscreen}
          onToggleConsole={(value) => void handleToggleConsole(value)}
          onToggleFullscreen={(value) => void handleToggleFullscreen(value)}
        />

        <ClientLoaderSection
          client={client}
          loader={resolved.loader}
          loaderOverridden={loaderOverridden}
          isSavingOverride={isSavingOverride}
          onSwitchLoader={(loader) => setClientOverride({ slug, patch: { loader } })}
        />

        {currentRuntime && <ClientRuntimeSection runtime={currentRuntime} />}

        <ClientActionsSection
          status={runtimeState.status}
          repairPending={repairMutation.isPending}
          cancelPending={cancelMutation.isPending}
          uninstallPending={uninstallMutation.isPending}
          onRepair={() => void repairMutation.mutateAsync(slug)}
          onCancel={() => void cancelMutation.mutateAsync(slug)}
          onRequestUninstall={() => setConfirmUninstallOpen(true)}
        />

        <UninstallConfirmModal
          isOpen={confirmUninstallOpen}
          clientTitle={client.title}
          onClose={() => setConfirmUninstallOpen(false)}
          onConfirm={() => {
            setConfirmUninstallOpen(false);
            void uninstallMutation.mutateAsync(slug).then(() => onClose());
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t('clientSettings.footnote')}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleResetAll()}
          disabled={!hasAnyOverride}
        >
          {t('clientSettings.resetAll')}
        </Button>
      </div>
    </Modal>
  );
};
