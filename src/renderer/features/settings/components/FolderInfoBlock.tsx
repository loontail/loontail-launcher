import { Button } from '@renderer/shared/ui/Button';
import { OverrideMark } from '@renderer/shared/ui/OverrideMark';
import { Skeleton } from '@renderer/shared/ui/Skeleton';
import type { DiskInfo, FolderSize } from '@shared/contracts/system';
import { Folder, HardDrive } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { computeDiskUsageRatios } from '../lib/diskUsage';
import { formatBytes } from '../lib/formatBytes';

type FolderInfoBlockProps = {
  folder: DiskInfo | null | undefined;
  folderSize?: FolderSize | null | undefined;
  folderSizeLoading?: boolean;
  pathLoading?: boolean;
  heading: ReactNode;
  description?: ReactNode | undefined;
  path?: string | undefined;
  onOpen: () => void;
  onChange: () => void;
  openLabel?: string;
  changeLabel?: string;
  showDiskUsage?: boolean;
  overridden?: boolean;
  disabled?: boolean;
};

export const FolderInfoBlock = ({
  folder,
  folderSize,
  folderSizeLoading = false,
  pathLoading = false,
  heading,
  description,
  path,
  onOpen,
  onChange,
  openLabel,
  changeLabel,
  showDiskUsage = false,
  overridden = false,
  disabled = false,
}: FolderInfoBlockProps) => {
  const { t } = useTranslation();

  const displayPath = path ?? folder?.path ?? '';
  const diskLoading = showDiskUsage && (folder === undefined || folder === null);
  const hasUsage =
    showDiskUsage &&
    folder !== null &&
    folder !== undefined &&
    folder.error !== true &&
    typeof folder.free === 'number' &&
    typeof folder.size === 'number' &&
    folder.size > 0;

  const folderBytes = typeof folderSize?.bytes === 'number' ? folderSize.bytes : null;
  const { clampedFolderRatio, restUsedRatio } = computeDiskUsageRatios({
    hasUsage,
    folder,
    folderBytes,
  });

  const resolvedOpenLabel = openLabel ?? t('settings.system.openFolder');
  const resolvedChangeLabel = changeLabel ?? t('settings.system.change');

  const showUsageRow = diskLoading || hasUsage;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted text-foreground">
          <HardDrive className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h4 className="text-sm font-semibold text-foreground">
            {heading}
            <OverrideMark shown={overridden} />
          </h4>
          {description !== undefined && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onOpen}
            disabled={disabled || !displayPath || pathLoading}
          >
            {resolvedOpenLabel}
          </Button>
          <Button variant="outline" size="sm" onClick={onChange} disabled={disabled}>
            {resolvedChangeLabel}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-sm border border-border bg-background p-3">
        <div className="flex h-4 items-center gap-2 text-xs">
          <Folder className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          {pathLoading ? (
            <Skeleton className="h-3.5 w-48 max-w-full" />
          ) : (
            <span className="truncate font-mono text-muted-foreground">
              {displayPath || t('settings.system.folderNotSet')}
            </span>
          )}
        </div>
        {showUsageRow && (
          <>
            {diskLoading ? (
              <Skeleton className="h-1.5 w-full rounded-full" />
            ) : (
              <div className="flex h-1.5 w-full items-center gap-1">
                {restUsedRatio > 0 && (
                  <div
                    className="h-full rounded-full bg-foreground/85 transition-all"
                    style={{ width: `${restUsedRatio * 100}%` }}
                  />
                )}
                {clampedFolderRatio > 0 && (
                  <div
                    className="h-full rounded-full bg-foreground/85 transition-all"
                    style={{
                      width: `${clampedFolderRatio * 100}%`,
                      minWidth: folderBytes !== null && folderBytes > 0 ? '0.5rem' : undefined,
                    }}
                  />
                )}
                <div className="h-full flex-1 rounded-full bg-muted" />
              </div>
            )}
            <div className="flex h-4 items-center justify-between text-xs text-muted-foreground">
              {diskLoading ? (
                <>
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-32" />
                </>
              ) : (
                <>
                  {folderSizeLoading || folderBytes === null ? (
                    <Skeleton className="h-3 w-20" />
                  ) : (
                    <span>
                      {t('settings.system.folderUsed', { value: formatBytes(folderBytes) })}
                    </span>
                  )}
                  <span>
                    {t('settings.system.diskFree', {
                      free: formatBytes(folder?.free),
                      total: formatBytes(folder?.size),
                    })}
                  </span>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
