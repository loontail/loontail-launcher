import { formatBytes } from '@renderer/features/settings/lib/formatBytes';
import { describe, expect, it } from 'vitest';

const MB = 1024 ** 2;
const GB = 1024 ** 3;

describe('formatBytes', () => {
  it('uses the default placeholder for non-number input', () => {
    expect(formatBytes(undefined)).toBe('—');
  });

  it('honours a custom placeholder', () => {
    expect(formatBytes(undefined, { placeholder: '…' })).toBe('…');
  });

  it('formats GB with two decimals at or above 1 GB (default maxUnit)', () => {
    expect(formatBytes(2 * GB)).toBe('2.00 GB');
    expect(formatBytes(GB)).toBe('1.00 GB');
  });

  it('falls back to whole MB below 1 GB (default maxUnit)', () => {
    expect(formatBytes(512 * MB)).toBe('512 MB');
  });

  it('formats MB with one decimal at or above 1 MB when maxUnit is mb', () => {
    expect(formatBytes(Math.round(1.5 * MB), { maxUnit: 'mb' })).toBe('1.5 MB');
  });

  it('formats whole KB below 1 MB when maxUnit is mb', () => {
    expect(formatBytes(2048, { maxUnit: 'mb' })).toBe('2 KB');
  });
});
