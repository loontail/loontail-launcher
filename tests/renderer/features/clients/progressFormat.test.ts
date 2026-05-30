import {
  formatBytes,
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
