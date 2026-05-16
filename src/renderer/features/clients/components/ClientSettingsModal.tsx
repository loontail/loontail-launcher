import {
  FolderInfoBlock,
  RamControl,
  openPath,
  useChooseClientFolder,
  useClearClientOverrides,
  useDiskSpace,
  useLauncherSettings,
  useRamRange,
  useResolveFor,
  useSetClientOverride,
} from '@renderer/features/settings';
import { Button } from '@renderer/shared/ui/Button';
import { Modal } from '@renderer/shared/ui/Modal';
import { OverrideMark } from '@renderer/shared/ui/OverrideMark';
import { SettingsGroup } from '@renderer/shared/ui/SettingsGroup';
import { SettingsRow, SettingsSwitchRow } from '@renderer/shared/ui/SettingsRow';
import type { Client } from '@shared/contracts/client';
import type { BundleSlug } from '@shared/contracts/ids';
import { RotateCcw, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type ClientSettingsModalProps = {
  isOpen: boolean;
  client: Client | null;
  onClose: () => void;
};

export const ClientSettingsModal = ({ isOpen, client, onClose }: ClientSettingsModalProps) => {
  const { t } = useTranslation();
  const bundleSlug = (client?.bundleSlug ?? null) as BundleSlug | null;

  const { settings, isPending: settingsPending } = useLauncherSettings();
  const resolved = useResolveFor(bundleSlug);
  const { range, isPending: rangePending } = useRamRange();
  const { info: diskInfo } = useDiskSpace(resolved?.storage.clientFolder);
  const { mutate: setClientOverride, isPending: isSavingOverride } = useSetClientOverride();
  const { mutate: clearClientOverrides } = useClearClientOverrides();
  const { mutate: chooseClientFolder } = useChooseClientFolder();

  const savedRam = resolved?.memory.allocatedRamMb ?? 0;
  const [pendingRam, setPendingRam] = useState<number | null>(null);
  const ramValue = pendingRam ?? savedRam;

  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger on modal toggle / client switch — start RAM from fresh resolved value
  useEffect(() => {
    setPendingRam(null);
  }, [isOpen, bundleSlug]);

  if (!client || !bundleSlug || !resolved || !settings) return null;

  const ramReady = !settingsPending && !rangePending && range !== undefined;

  const handleRamSave = async () => {
    if (pendingRam === null) return;
    await setClientOverride({
      bundleSlug,
      patch: { memory: { allocatedRamMb: pendingRam } },
    });
    setPendingRam(null);
  };

  const handleToggleConsole = async (value: boolean) => {
    await setClientOverride({ bundleSlug, patch: { launch: { console: value } } });
  };

  const handleToggleFullscreen = async (value: boolean) => {
    await setClientOverride({ bundleSlug, patch: { launch: { fullscreen: value } } });
  };

  const handleResetAll = async () => {
    await clearClientOverrides(bundleSlug);
    setPendingRam(null);
  };

  const handleChangeFolder = async () => {
    await chooseClientFolder(bundleSlug);
  };

  const handleOpenFolder = () => {
    if (resolved.storage.clientFolder) void openPath(resolved.storage.clientFolder);
  };

  const hasAnyOverride = Object.values(resolved.diff).some(Boolean);

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

        <SettingsGroup title={t('settings.game.launch')}>
          <SettingsSwitchRow
            label={
              <>
                {t('settings.game.console')}
                <OverrideMark shown={resolved.diff.console} />
              </>
            }
            description={t('settings.game.consoleDesc')}
            checked={resolved.launch.console}
            onCheckedChange={(value) => void handleToggleConsole(value)}
          />
          <SettingsSwitchRow
            label={
              <>
                {t('settings.game.fullscreen')}
                <OverrideMark shown={resolved.diff.fullscreen} />
              </>
            }
            description={t('settings.game.fullscreenDesc')}
            checked={resolved.launch.fullscreen}
            onCheckedChange={(value) => void handleToggleFullscreen(value)}
          />
        </SettingsGroup>

        <SettingsGroup title={t('clientSettings.actions')}>
          <SettingsRow
            label={t('clientSettings.repair')}
            description={t('clientSettings.repairDesc')}
            right={
              <Button variant="outline" size="sm" onClick={() => {}}>
                <RotateCcw className="size-3.5" strokeWidth={2} />
                {t('clientSettings.repair')}
              </Button>
            }
          />
          <SettingsRow
            label={t('clientSettings.uninstall')}
            description={t('clientSettings.uninstallDesc')}
            right={
              <Button variant="destructive" size="sm" onClick={() => {}}>
                <Trash2 className="size-3.5" strokeWidth={2} />
                {t('clientSettings.uninstall')}
              </Button>
            }
          />
        </SettingsGroup>
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
