import {
  computeEtaSeconds,
  formatBytes,
  formatEta,
  formatSpeed,
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
