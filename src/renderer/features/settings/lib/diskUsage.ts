import type { DiskInfo } from '@shared/contracts/system';

type DiskUsageRatios = {
  clampedFolderRatio: number;
  restUsedRatio: number;
};

type ComputeArgs = {
  hasUsage: boolean;
  folder: DiskInfo | null | undefined;
  folderBytes: number | null;
};

export const computeDiskUsageRatios = ({
  hasUsage,
  folder,
  folderBytes,
}: ComputeArgs): DiskUsageRatios => {
  const diskTotal = hasUsage ? (folder?.size ?? 1) : 1;
  const diskUsedBytes = hasUsage ? diskTotal - (folder?.free ?? 0) : 0;
  const diskUsedRatio = hasUsage ? diskUsedBytes / diskTotal : 0;
  const folderRatio = hasUsage && folderBytes !== null ? folderBytes / diskTotal : 0;
  // Clamp so a lagging folder-size scan can't overshoot the total-used segment.
  const clampedFolderRatio = Math.min(folderRatio, diskUsedRatio);
  const restUsedRatio = Math.max(0, diskUsedRatio - clampedFolderRatio);
  return { clampedFolderRatio, restUsedRatio };
};
