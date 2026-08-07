const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export const formatBytes = (bytes: number): string => {
  // Guard sub-byte values: Math.log would go negative and index SIZE_UNITS out of bounds.
  if (bytes < 1) return '0 B';
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), SIZE_UNITS.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${SIZE_UNITS[unit]}`;
};

export const formatSpeed = (bytesPerSec: number): string =>
  bytesPerSec > 0 ? `${formatBytes(bytesPerSec)}/s` : '';

// Null when the estimate is meaningless (stalled/complete/negative) so the UI can hide it.
export const computeEtaSeconds = (bytesRemaining: number, bytesPerSec: number): number | null => {
  if (bytesPerSec <= 0 || bytesRemaining <= 0) return null;
  return bytesRemaining / bytesPerSec;
};

export const formatEta = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
};
