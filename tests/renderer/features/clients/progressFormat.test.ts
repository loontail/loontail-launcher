import {
  clampMonotonicPercent,
  computeEtaSeconds,
  formatBytes,
  formatEta,
  formatSpeed,
  rollingSpeed,
} from '@renderer/features/clients/components/install/progressFormat';
import { describe, expect, it } from 'vitest';

describe('formatBytes', () => {
  it('renders zero and sub-byte values as 0 B', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(0.5)).toBe('0 B');
    expect(formatBytes(-10)).toBe('0 B');
  });

  it('formats whole-byte and multi-unit values', () => {
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1_073_741_824)).toBe('1.0 GB');
  });
});

describe('formatSpeed', () => {
  it('appends /s for positive rates and is empty otherwise', () => {
    expect(formatSpeed(1024)).toBe('1.0 KB/s');
    expect(formatSpeed(0)).toBe('');
  });
});

describe('rollingSpeed', () => {
  it('averages bytes/sec across all samples in the window', () => {
    // 4 KB gained over 4s -> 1 KB/s, regardless of intra-window jitter.
    const samples: Array<[number, number]> = [
      [0, 0],
      [1000, 100],
      [2000, 4000],
      [4000, 4096],
    ];
    expect(rollingSpeed(samples, 4000, 5000)).toBeCloseTo(1024, 0);
  });

  it('drops samples older than the window so a past burst does not skew the rate', () => {
    // Old burst (0..1000) sits outside a 3s window ending at 5000; only the
    // steady tail (2000..5000, 3 KB over 3s) counts.
    const samples: Array<[number, number]> = [
      [0, 0],
      [1000, 1_000_000],
      [2000, 1_003_072],
      [5000, 1_006_144],
    ];
    expect(rollingSpeed(samples, 5000, 3000)).toBeCloseTo(1024, 0);
  });

  it('returns 0 with fewer than two in-window samples', () => {
    expect(rollingSpeed([[1000, 500]], 1000, 3000)).toBe(0);
    expect(rollingSpeed([], 0, 3000)).toBe(0);
  });
});

describe('computeEtaSeconds', () => {
  it('divides remaining bytes by the smoothed speed', () => {
    expect(computeEtaSeconds(2048, 1024)).toBe(2);
  });

  it('returns null when speed is non-positive or nothing remains', () => {
    expect(computeEtaSeconds(2048, 0)).toBeNull();
    expect(computeEtaSeconds(0, 1024)).toBeNull();
    expect(computeEtaSeconds(-10, 1024)).toBeNull();
  });
});

describe('formatEta', () => {
  it('formats sub-hour durations as m:ss and short ones as seconds', () => {
    expect(formatEta(5)).toBe('5s');
    expect(formatEta(65)).toBe('1:05');
    expect(formatEta(3661)).toBe('1:01:01');
  });

  it('renders nothing when ETA is unknown', () => {
    expect(formatEta(null)).toBe('');
  });
});

describe('clampMonotonicPercent', () => {
  it('never decreases the displayed percent', () => {
    expect(clampMonotonicPercent(40, 55)).toBe(55);
    // A lower reading after a higher one keeps the higher value.
    expect(clampMonotonicPercent(55, 30)).toBe(55);
  });

  it('clamps into the 0..100 range', () => {
    expect(clampMonotonicPercent(0, -5)).toBe(0);
    expect(clampMonotonicPercent(0, 120)).toBe(100);
    expect(clampMonotonicPercent(90, 999)).toBe(100);
  });
});
