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
import { Button } from '@renderer/shared/ui/Button';
import { SettingsGroup } from '@renderer/shared/ui/SettingsGroup';
import { SettingsRow } from '@renderer/shared/ui/SettingsRow';
import { QUERY_KEYS } from '@shared/constants';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Sparkles } from 'lucide-react';
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

  const { info: diskInfo } = useDiskSpace(localPath || null);
  const { info: folderSize, isPending: folderSizePending } = useFolderSize(localPath || null);

  const handlePick = async () => {
    const picked = await pickInstallFolder();
    if (picked) {
      setLocalPath(picked.path);
      setUserTouched(true);
    }
  };

  const handleFinish = async () => {
    if (!localPath) return;
    await setLauncher({ storage: { clientsFolder: localPath } });
  };

  const canFinish = localPath.length > 0 && !isSaving;

  return (
    <div className="relative flex h-full flex-1 items-center justify-center overflow-auto bg-background">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 size-[900px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-glass/8 blur-[160px]" />
      </div>
      <div className="relative z-10 flex w-full max-w-md flex-col gap-5 px-6 py-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full border border-border bg-card/80 text-foreground backdrop-blur-sm">
            <Sparkles className="size-5" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {t('setup.title')}
            </h1>
            <p className="text-xs leading-relaxed text-muted-foreground">{t('setup.subtitle')}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <SettingsGroup>
            <SettingsRow
              label={t('settings.launcher.language')}
              description={t('settings.launcher.languageDesc')}
              right={<LanguageSwitcher />}
            />
          </SettingsGroup>

          <FolderInfoBlock
            folder={diskInfo}
            folderSize={folderSize}
            folderSizeLoading={folderSizePending}
            heading={t('settings.system.clientsFolder')}
            description={t('settings.system.clientsFolderDesc')}
            path={localPath}
            onOpen={() => {
              if (localPath) void openPath(localPath);
            }}
            onChange={() => void handlePick()}
            showDiskUsage={localPath.length > 0}
            disabled={isSaving}
          />
        </div>

        <Button
          className="h-10 w-full"
          disabled={!canFinish}
          onClick={() => void handleFinish()}
          aria-busy={isSaving}
        >
          {isSaving ? <Loader2 className="size-4 animate-spin" /> : t('setup.finish')}
        </Button>
      </div>
    </div>
  );
};
