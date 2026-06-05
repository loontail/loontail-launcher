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
import { Modal } from '@renderer/shared/ui/Modal';
import type { Client } from '@shared/contracts/client';
import type { ClientSlug } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import type { LauncherSettings, ResolvedClientSettings } from '@shared/contracts/settings';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClientActionsSection } from './client-settings/ClientActionsSection';
import { ClientLaunchSection } from './client-settings/ClientLaunchSection';
import { ClientLoaderSection } from './client-settings/ClientLoaderSection';
import { ClientRuntimeSection } from './client-settings/ClientRuntimeSection';
import { UninstallConfirmModal } from './client-settings/UninstallConfirmModal';
import { useClientSettingsActions } from './useClientSettingsActions';

type ClientSettingsModalProps = {
  isOpen: boolean;
  client: Client | null;
  onClose: () => void;
};

export const ClientSettingsModal = ({ isOpen, client, onClose }: ClientSettingsModalProps) => {
  const slug = client?.slug ?? null;
  const { settings, isPending: settingsPending } = useLauncherSettings();
  const resolved = useResolveFor(slug);

  if (!client || !slug || !resolved || !settings) return null;

  return (
    <ClientSettingsModalContent
      isOpen={isOpen}
      client={client}
      slug={slug}
      resolved={resolved}
      settings={settings}
      settingsPending={settingsPending}
      onClose={onClose}
    />
  );
};

type ContentProps = {
  isOpen: boolean;
  client: Client;
  slug: ClientSlug;
  resolved: ResolvedClientSettings;
  settings: LauncherSettings;
  settingsPending: boolean;
  onClose: () => void;
};

const ClientSettingsModalContent = ({
  isOpen,
  client,
  slug,
  resolved,
  settings,
  settingsPending,
  onClose,
}: ContentProps) => {
  const { t } = useTranslation();
  const { range, isPending: rangePending } = useRamRange();
  const { info: diskInfo } = useDiskSpace(resolved.storage.clientFolder);
  const { info: folderSize, isPending: folderSizePending } = useFolderSize(
    resolved.storage.clientFolder,
  );
  const runtimeState = useClientStatus(slug);
  const repairMutation = useRepairClient();
  const uninstallMutation = useUninstallClient();
  const [confirmUninstallOpen, setConfirmUninstallOpen] = useState(false);

  const actions = useClientSettingsActions({ slug, resolved, resetKey: `${isOpen}:${slug}` });

  const ramReady = !settingsPending && !rangePending && range !== undefined;
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
          folderSize={folderSize}
          folderSizeLoading={folderSizePending}
          pathLoading={settingsPending}
          heading={t('clientSettings.clientFolder')}
          description={t('clientSettings.clientFolderDesc')}
          path={resolved.storage.clientFolder}
          onOpen={actions.openFolder}
          onChange={() => void actions.changeFolder()}
          openLabel={t('clientSettings.openFolder')}
          changeLabel={t('clientSettings.changeFolder')}
          showDiskUsage={resolved.storage.clientFolder.length > 0}
          overridden={resolved.diff.folder}
        />

        <ClientLaunchSection
          launch={resolved.launch}
          consoleOverridden={resolved.diff.console}
          fullscreenOverridden={resolved.diff.fullscreen}
          onToggleConsole={(value) => void actions.toggleConsole(value)}
          onToggleFullscreen={(value) => void actions.toggleFullscreen(value)}
        />

        <ClientLoaderSection
          client={client}
          loader={resolved.loader}
          loaderOverridden={loaderOverridden}
          isSavingOverride={actions.isSavingOverride}
          onSwitchLoader={(loader) => void actions.setLoader(loader)}
        />

        {currentRuntime && <ClientRuntimeSection runtime={currentRuntime} />}

        <ClientActionsSection
          status={runtimeState.status}
          repairPending={repairMutation.isPending}
          uninstallPending={uninstallMutation.isPending}
          onRepair={() => void repairMutation.mutateAsync(slug)}
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
          onClick={() => void actions.resetAll()}
          disabled={!hasAnyOverride}
        >
          {t('clientSettings.resetAll')}
        </Button>
      </div>
    </Modal>
  );
};
