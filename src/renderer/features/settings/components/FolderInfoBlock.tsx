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
  // True only while the probe is in flight: a rejected probe (refused or
  // unreadable path) has to drop the skeleton instead of spinning forever.
  diskInfoPending?: boolean;
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
  overridden?: boolean;
  disabled?: boolean;
};

export const FolderInfoBlock = ({
  folder,
  diskInfoPending = false,
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
  overridden = false,
  disabled = false,
}: FolderInfoBlockProps) => {
  const { t } = useTranslation();

  const displayPath = path ?? folder?.path ?? '';
  // Derived, not a prop: a caller could otherwise pass a flag inconsistent with
  // the path it also passes, and the internals would contradict it.
  const showDiskUsage = (path ?? '').length > 0;
  const diskLoading = showDiskUsage && diskInfoPending;
  const hasUsage = showDiskUsage && folder !== null && folder !== undefined && folder.size > 0;

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
    <div className="flex flex-col gap-3 rounded-md border border-edge bg-surface-1 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-text-hi">
          <HardDrive className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h4 className="text-sm font-semibold text-text-hi">
            {heading}
            <OverrideMark shown={overridden} />
          </h4>
          {description !== undefined && <p className="text-xs text-text-mute">{description}</p>}
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

      <div className="flex flex-col gap-2 rounded-sm border border-edge bg-canvas p-3">
        <div className="flex h-4 items-center gap-2 text-xs">
          <Folder className="size-3.5 shrink-0 text-text-mute" strokeWidth={1.75} />
          {pathLoading ? (
            <Skeleton className="h-3.5 w-48 max-w-full" />
          ) : (
            <span className="truncate font-mono text-text-mute">
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
                    className="h-full rounded-full bg-cta/85 transition-all"
                    style={{ width: `${restUsedRatio * 100}%` }}
                  />
                )}
                {clampedFolderRatio > 0 && (
                  <div
                    className="h-full rounded-full bg-cta/85 transition-all"
                    style={{
                      width: `${clampedFolderRatio * 100}%`,
                      minWidth: folderBytes !== null && folderBytes > 0 ? '0.5rem' : undefined,
                    }}
                  />
                )}
                <div className="h-full flex-1 rounded-full bg-surface-2" />
              </div>
            )}
            <div className="flex h-4 items-center justify-between text-xs text-text-mute">
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
