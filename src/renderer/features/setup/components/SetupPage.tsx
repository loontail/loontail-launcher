import {
  FolderInfoBlock,
  LanguageSwitcher,
  openPath,
  useDiskSpace,
  useFolderSize,
  useSetLauncher,
} from '@renderer/features/settings';
import { getDefaultInstallFolder, pickInstallFolder } from '@renderer/features/settings/systemApi';
import { NEVER_CACHE } from '@renderer/shared/lib/queryClient';
import { SettingsRow } from '@renderer/shared/ui/SettingsRow';
import { QUERY_KEYS } from '@shared/constants';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const SetupPage = () => {
  const { t } = useTranslation();
  const { mutate: setLauncher, isPending: isSaving } = useSetLauncher();
  const [localPath, setLocalPath] = useState<string>('');
  const [userTouched, setUserTouched] = useState(false);

  const { data: defaultPath } = useQuery({
    queryKey: QUERY_KEYS.system.defaultInstallFolder,
    queryFn: getDefaultInstallFolder,
    ...NEVER_CACHE,
  });

  useEffect(() => {
    if (!userTouched && defaultPath && localPath.length === 0) {
      setLocalPath(defaultPath);
    }
  }, [defaultPath, userTouched, localPath]);

  const { info: diskInfo, isPending: diskInfoPending } = useDiskSpace(localPath || null);
  const { info: folderSize, isPending: folderSizePending } = useFolderSize(localPath || null);

  const handlePick = async () => {
    const picked = await pickInstallFolder();
    if (picked) {
      setLocalPath(picked.path);
      setUserTouched(true);
    }
  };

  const handleFinish = (): void => {
    if (!localPath) return;
    setLauncher({ storage: { clientsFolder: localPath } });
  };

  const canFinish = localPath.length > 0 && !isSaving;

  return (
    <div className="relative flex h-full flex-1 items-center justify-center overflow-auto bg-canvas scrim-app">
      <div className="relative z-10 flex w-full max-w-md flex-col gap-6 rounded-lg border border-edge bg-surface-1 p-8 motion-safe:animate-route-fade">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-full border border-edge-md bg-surface-2">
            <span className="size-2.5 rotate-45 rounded-xs bg-glass/85 shadow-[0_0_10px_var(--color-glow-glass)]" />
          </span>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-h1 text-text-hi">{t('setup.title')}</h1>
            <p className="text-body leading-relaxed text-text-mute">{t('setup.subtitle')}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-md border border-edge bg-surface-2">
            <SettingsRow
              label={t('settings.launcher.language')}
              description={t('settings.launcher.languageDesc')}
              right={<LanguageSwitcher />}
            />
          </div>

          <FolderInfoBlock
            folder={diskInfo}
            diskInfoPending={diskInfoPending}
            folderSize={folderSize}
            folderSizeLoading={folderSizePending}
            heading={t('settings.system.clientsFolder')}
            description={t('settings.system.clientsFolderDesc')}
            path={localPath}
            onOpen={() => {
              if (localPath) void openPath(localPath);
            }}
            onChange={() => void handlePick()}
            disabled={isSaving}
          />
        </div>

        <button
          type="button"
          className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-cta px-6 text-body-med text-on-cta shadow-[inset_0_1px_0_var(--shadow-inset-highlight)] transition-all duration-150 ease-standard hover:bg-cta-hover active:bg-cta-press motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 disabled:pointer-events-none disabled:opacity-50"
          disabled={!canFinish}
          onClick={handleFinish}
          aria-busy={isSaving}
        >
          {isSaving ? <Loader2 className="size-4 animate-spin" /> : t('setup.finish')}
        </button>
      </div>
    </div>
  );
};
