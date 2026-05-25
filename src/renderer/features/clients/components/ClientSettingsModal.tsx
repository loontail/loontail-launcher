import { useClientStatus, useRepairClient, useUninstallClient } from '@renderer/features/minecraft';
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
import type { Translator } from '@renderer/i18n';
import { cn } from '@renderer/shared/lib/cn';
import { Button } from '@renderer/shared/ui/Button';
import { Modal } from '@renderer/shared/ui/Modal';
import { OverrideMark } from '@renderer/shared/ui/OverrideMark';
import { SettingsGroup } from '@renderer/shared/ui/SettingsGroup';
import { SettingsRow, SettingsSwitchRow } from '@renderer/shared/ui/SettingsRow';
import type { Client } from '@shared/contracts/client';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { type LoaderChoice, LoaderChoices } from '@shared/contracts/settings';
import { resolveLoader } from '@shared/domain/loader';
import { FolderOpen, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type ClientSettingsModalProps = {
  isOpen: boolean;
  client: Client | null;
  onClose: () => void;
};

const pickLoaderVersion = (
  loader: LoaderChoice | null,
  client: Pick<Client, 'forgeVersion' | 'fabricVersion'>,
): string | null => {
  if (loader === LoaderChoices.FORGE) return client.forgeVersion ?? null;
  if (loader === LoaderChoices.FABRIC) return client.fabricVersion ?? null;
  return null;
};

const renderLoaderKindControl = (args: {
  canSwitchLoader: boolean;
  effectiveLoader: LoaderChoice | null;
  isSavingOverride: boolean;
  switchLoader: (loader: typeof LoaderChoices.FORGE | typeof LoaderChoices.FABRIC) => void;
  t: Translator;
}): ReactNode => {
  const { canSwitchLoader, effectiveLoader, isSavingOverride, switchLoader, t } = args;
  if (canSwitchLoader) {
    return (
      <div
        aria-label={t('clientSettings.loader.title')}
        className="inline-flex rounded-full border border-edge-md bg-chip-dark p-0.5"
      >
        {[LoaderChoices.FORGE, LoaderChoices.FABRIC].map((option) => {
          const active = effectiveLoader === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              disabled={isSavingOverride || active}
              onClick={() => switchLoader(option)}
              className={cn(
                'px-3 py-1 text-eyebrow font-semibold transition-colors rounded-full',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/40',
                active ? 'bg-primary text-primary-foreground' : 'text-glass/65 hover:text-glass',
              )}
            >
              {t(`clientSettings.loader.${option}`)}
            </button>
          );
        })}
      </div>
    );
  }
  if (effectiveLoader) {
    return (
      <span className="text-caption font-semibold text-glass/85">
        {t(`clientSettings.loader.${effectiveLoader}`)}
      </span>
    );
  }
  return <span className="text-caption font-semibold text-glass/55">—</span>;
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

        {(() => {
          const resolution = resolveLoader(client, resolved.loader);
          const effectiveLoader = resolution.kind === 'resolved' ? resolution.loader : null;
          const hasForge = Boolean(client.forgeVersion);
          const hasFabric = Boolean(client.fabricVersion);
          const canSwitchLoader = hasForge && hasFabric;
          const loaderVersion = pickLoaderVersion(effectiveLoader, client);
          const switchLoader = (loader: typeof LoaderChoices.FORGE | typeof LoaderChoices.FABRIC) =>
            setClientOverride({ slug, patch: { loader } });
          return (
            <SettingsGroup title={t('clientSettings.loader.title')}>
              <SettingsRow
                label={t('clientSettings.loader.kind')}
                description={canSwitchLoader ? t('clientSettings.loader.switchDesc') : undefined}
                right={renderLoaderKindControl({
                  canSwitchLoader,
                  effectiveLoader,
                  isSavingOverride,
                  switchLoader,
                  t,
                })}
              />
              <SettingsRow
                label={t('clientSettings.loader.minecraftVersion')}
                right={
                  <span className="select-text text-eyebrow font-medium tabular-nums text-glass/70">
                    {client.minecraftVersion || '—'}
                  </span>
                }
              />
              {loaderVersion && (
                <SettingsRow
                  label={t('clientSettings.loader.version')}
                  right={
                    <span className="select-text text-eyebrow font-medium tabular-nums text-glass/70">
                      {loaderVersion}
                    </span>
                  }
                />
              )}
            </SettingsGroup>
          );
        })()}

        {resolved.runtime && (
          <SettingsGroup title={t('clientSettings.runtime.title')}>
            <SettingsRow
              label={t('clientSettings.runtime.component')}
              description={t('clientSettings.runtime.componentDesc')}
              right={
                <span className="select-text text-eyebrow font-medium tabular-nums text-glass/70">
                  {resolved.runtime.component}
                </span>
              }
            />
            <SettingsRow
              label={t('clientSettings.runtime.path')}
              description={
                <span
                  className="block max-w-full select-text truncate font-mono text-microlabel text-glass/60"
                  title={resolved.runtime.path}
                  dir="rtl"
                >
                  {resolved.runtime.path}
                </span>
              }
              right={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (resolved.runtime?.path) void openPath(resolved.runtime.path);
                  }}
                >
                  <FolderOpen className="size-3.5" strokeWidth={2} />
                  {t('clientSettings.openFolder')}
                </Button>
              }
            />
          </SettingsGroup>
        )}

        <SettingsGroup title={t('clientSettings.actions')}>
          <SettingsRow
            label={t('clientSettings.repair')}
            description={t('clientSettings.repairDesc')}
            right={
              <Button
                variant="outline"
                size="sm"
                disabled={
                  runtimeState.status !== InstallStatuses.INSTALLED || repairMutation.isPending
                }
                onClick={() => {
                  void repairMutation.mutateAsync(slug);
                }}
              >
                {runtimeState.status === InstallStatuses.REPAIRING ? (
                  <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
                ) : (
                  <RotateCcw className="size-3.5" strokeWidth={2} />
                )}
                {t('clientSettings.repair')}
              </Button>
            }
          />
          <SettingsRow
            label={t('clientSettings.uninstall')}
            description={t('clientSettings.uninstallDesc')}
            right={
              <Button
                variant="destructive"
                size="sm"
                disabled={
                  runtimeState.status !== InstallStatuses.INSTALLED || uninstallMutation.isPending
                }
                onClick={() => setConfirmUninstallOpen(true)}
              >
                <Trash2 className="size-3.5" strokeWidth={2} />
                {t('clientSettings.uninstall')}
              </Button>
            }
          />
        </SettingsGroup>

        <Modal
          isOpen={confirmUninstallOpen}
          onClose={() => setConfirmUninstallOpen(false)}
          ariaLabel={t('clientSettings.uninstallConfirmTitle')}
          className="max-w-sm"
        >
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {t('clientSettings.uninstallConfirmTitle')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('clientSettings.uninstallConfirm', { name: client.title })}
            </p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmUninstallOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirmUninstallOpen(false);
                void uninstallMutation.mutateAsync(slug).then(() => onClose());
              }}
            >
              {t('clientSettings.uninstall')}
            </Button>
          </div>
        </Modal>
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
