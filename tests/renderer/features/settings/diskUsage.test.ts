import { computeDiskUsageRatios } from '@renderer/features/settings/lib/diskUsage';
import type { DiskInfo } from '@shared/contracts/system';
import { describe, expect, it } from 'vitest';

const disk = (size: number, free: number): DiskInfo =>
  ({ size, free, path: '/x', error: false }) as unknown as DiskInfo;

describe('computeDiskUsageRatios', () => {
  it('returns all-zero ratios when usage is unavailable', () => {
    expect(
      computeDiskUsageRatios({ hasUsage: false, folder: undefined, folderBytes: null }),
    ).toEqual({
      clampedFolderRatio: 0,
      restUsedRatio: 0,
    });
  });

  it('computes used and folder ratios against the disk total', () => {
    const r = computeDiskUsageRatios({
      hasUsage: true,
      folder: disk(1000, 600),
      folderBytes: 100,
    });
    // 40% of the disk is used and the launcher folder accounts for 10 of it.
    expect(r.clampedFolderRatio).toBeCloseTo(0.1);
    expect(r.restUsedRatio).toBeCloseTo(0.3);
  });

  it('clamps the folder ratio so it never exceeds the used ratio', () => {
    const r = computeDiskUsageRatios({
      hasUsage: true,
      folder: disk(1000, 700),
      folderBytes: 900,
    });
    // A lagging folder-size scan reports 90% of a disk that is only 30% used;
    // the folder segment is clamped and the remainder floors at zero.
    expect(r.clampedFolderRatio).toBeCloseTo(0.3);
    expect(r.restUsedRatio).toBe(0);
  });

  it('treats an unknown folder size as zero folder ratio', () => {
    const r = computeDiskUsageRatios({
      hasUsage: true,
      folder: disk(1000, 600),
      folderBytes: null,
    });
    expect(r.clampedFolderRatio).toBe(0);
    expect(r.restUsedRatio).toBeCloseTo(0.4);
  });
});
