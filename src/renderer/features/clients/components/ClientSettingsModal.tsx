import { operationalId, useDeleteBuild } from '@renderer/features/catalog';
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
import { type CatalogItem, type LocalCatalogItem, SourceKinds } from '@shared/contracts/catalog';
import type { ClientSlug } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import type { LauncherSettings, ResolvedClientSettings } from '@shared/contracts/settings';
import { Trash2, X } from 'lucide-react';
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
  item: CatalogItem | null;
  onClose: () => void;
  // Notifies the parent (e.g. the detail modal) that the build was deleted, so it
  // can close too rather than linger on a now-removed build.
  onBuildDeleted?: () => void;
};

export const ClientSettingsModal = ({
  isOpen,
  item,
  onClose,
  onBuildDeleted,
}: ClientSettingsModalProps) => {
  const slug = item ? operationalId(item) : null;
  const { settings, isPending: settingsPending } = useLauncherSettings();
  const resolved = useResolveFor(slug);

  if (!item || !slug || !resolved || !settings) return null;

  return (
    <ClientSettingsModalContent
      isOpen={isOpen}
      item={item}
      slug={slug}
      resolved={resolved}
      settings={settings}
      settingsPending={settingsPending}
      onClose={onClose}
      onBuildDeleted={onBuildDeleted}
    />
  );
};

type ContentProps = {
  isOpen: boolean;
  item: CatalogItem;
  slug: ClientSlug;
  resolved: ResolvedClientSettings;
  settings: LauncherSettings;
  settingsPending: boolean;
  onClose: () => void;
  onBuildDeleted?: (() => void) | undefined;
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
    <div className="flex items-center justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-caption font-semibold text-foreground">
          {t('clientSettings.deleteBuild')}
        </span>
        <span className="text-xs text-muted-foreground">{t('clientSettings.deleteBuildDesc')}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 text-destructive hover:bg-destructive/10"
        disabled={disabled || deleteBuild.isPending}
        onClick={() => setConfirmOpen(true)}
      >
        <Trash2 className="size-3.5" />
        {t('clientSettings.deleteBuild')}
      </Button>
      <UninstallConfirmModal
        isOpen={confirmOpen}
        clientTitle={item.presentation.title}
        title={t('clientSettings.deleteConfirmTitle')}
        message={t('clientSettings.deleteConfirm', { name: item.presentation.title })}
        confirmLabel={t('clientSettings.deleteBuild')}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void deleteBuild.mutateAsync(item.ref.id).then(onDeleted);
        }}
      />
    </div>
  );
};

const ClientSettingsModalContent = ({
  isOpen,
  item,
  slug,
  resolved,
  settings,
  settingsPending,
  onClose,
  onBuildDeleted,
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

  const title = item.presentation.title;
  const ramReady = !settingsPending && !rangePending && range !== undefined;
  const loaderOverridden = settings.clients[slug]?.loader !== undefined;
  const hasAnyOverride = Object.values(resolved.diff).some(Boolean) || loaderOverridden;
  const expectedRuntimeComponent = item.spec.runtimeVersion?.trim() || null;
  const currentRuntime =
    runtimeState.status === InstallStatuses.INSTALLED &&
    resolved.runtime &&
    (expectedRuntimeComponent === null || resolved.runtime.component === expectedRuntimeComponent)
      ? resolved.runtime
      : null;
  const isBusy =
    runtimeState.status === InstallStatuses.REPAIRING ||
    runtimeState.status === InstallStatuses.UNINSTALLING ||
    runtimeState.status === InstallStatuses.INSTALLING ||
    runtimeState.status === InstallStatuses.LAUNCHING ||
    runtimeState.status === InstallStatuses.RUNNING;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      scrollable
      ariaLabel={t('clientSettings.title', { name: title })}
      className="max-w-xl"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-base font-semibold text-foreground">
            {t('clientSettings.title', { name: title })}
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
          spec={item.spec}
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

        {item.kind === SourceKinds.LOCAL && (
          <DeleteBuildSection
            item={item}
            disabled={isBusy}
            onDeleted={() => {
              onClose();
              onBuildDeleted?.();
            }}
          />
        )}

        <UninstallConfirmModal
          isOpen={confirmUninstallOpen}
          clientTitle={title}
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
