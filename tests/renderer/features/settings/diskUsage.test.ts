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
      diskUsedRatio: 0,
      folderRatio: 0,
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
    expect(r.diskUsedRatio).toBeCloseTo(0.4);
    expect(r.folderRatio).toBeCloseTo(0.1);
    expect(r.clampedFolderRatio).toBeCloseTo(0.1);
    expect(r.restUsedRatio).toBeCloseTo(0.3);
  });

  it('clamps the folder ratio so it never exceeds the used ratio', () => {
    const r = computeDiskUsageRatios({
      hasUsage: true,
      folder: disk(1000, 700),
      folderBytes: 900,
    });
    expect(r.diskUsedRatio).toBeCloseTo(0.3);
    expect(r.folderRatio).toBeCloseTo(0.9);
    expect(r.clampedFolderRatio).toBeCloseTo(0.3);
    expect(r.restUsedRatio).toBe(0);
  });

  it('treats an unknown folder size as zero folder ratio', () => {
    const r = computeDiskUsageRatios({
      hasUsage: true,
      folder: disk(1000, 600),
      folderBytes: null,
    });
    expect(r.folderRatio).toBe(0);
    expect(r.clampedFolderRatio).toBe(0);
    expect(r.restUsedRatio).toBeCloseTo(0.4);
  });
});
