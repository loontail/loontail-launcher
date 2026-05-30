const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export const formatBytes = (bytes: number): string => {
  // Sub-byte values (e.g. fractional bytes from a stage-percent calculation)
  // would make Math.log negative and index SIZE_UNITS out of bounds → "NaN B".
  if (bytes < 1) return '0 B';
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), SIZE_UNITS.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${SIZE_UNITS[unit]}`;
};

export const formatSpeed = (bytesPerSec: number): string =>
  bytesPerSec > 0 ? `${formatBytes(bytesPerSec)}/s` : '';
