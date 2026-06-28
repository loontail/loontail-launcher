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

// Bytes/sec averaged over the first→last sample inside the window. A whole-window
// average (rather than the last delta) smooths the per-second jitter the install
// kit produces, so the speed/ETA readout stays steady. Samples are `[ms, bytes]`
// in ascending time order; callers prune backwards jumps before sampling.
export const rollingSpeed = (
  samples: ReadonlyArray<readonly [number, number]>,
  nowMs: number,
  windowMs: number,
): number => {
  const inWindow = samples.filter(([t]) => nowMs - t <= windowMs);
  if (inWindow.length < 2) return 0;
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  if (!first || !last) return 0;
  const dt = (last[0] - first[0]) / 1000;
  if (dt <= 0) return 0;
  const rate = (last[1] - first[1]) / dt;
  return rate > 0 ? rate : 0;
};

// Seconds remaining from a smoothed rate; null whenever the estimate is
// meaningless (stalled, complete, or a negative remainder) so the UI can hide it.
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
