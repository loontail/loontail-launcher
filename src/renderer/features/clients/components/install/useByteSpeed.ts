import { type SpeedWindow, createSpeedWindow } from '@shared/lib/speedWindow';
import { useEffect, useRef, useState } from 'react';

// 4s rolling window — wide enough to smooth the install kit's per-second jitter,
// short enough to react to a genuine slowdown within a few ticks.
const WINDOW_MS = 4000;

// Smoothed bytes/sec derived from successive `bytes` snapshots over a rolling
// window. Used for the repair path, whose adapter reports per-stage bytes but no
// rate; the install and bundle paths report their own throughput (the selector
// prefers `speedBytesPerSec` and falls back here only when it is absent).
//
// A backwards jump (resume after pause, or replanning) resets the window so
// the rate doesn't dip negative and recover slowly.
export const useByteSpeed = (bytes: number | undefined, active: boolean): number => {
  const windowRef = useRef<SpeedWindow>(undefined as unknown as SpeedWindow);
  if (!windowRef.current) windowRef.current = createSpeedWindow(WINDOW_MS);
  const [speed, setSpeed] = useState(0);

  useEffect(() => {
    if (!active || bytes === undefined) {
      windowRef.current.reset();
      setSpeed(0);
      return;
    }
    setSpeed(windowRef.current.sample(bytes, Date.now()));
  }, [bytes, active]);

  return speed;
};

// Display percent that never walks backwards. The selector recomputes percent
// from raw byte counts each tick; a stage-boundary recompute or a replan can
// momentarily report a lower value, which would make the bar visibly retreat.
// We latch the high-water mark and reset only when the source clearly restarts
// (a large drop, e.g. moving to the next stepper stage at 0%).
export const useMonotonicPercent = (percent: number, resetKey: string | number): number => {
  const peakRef = useRef(0);
  const keyRef = useRef(resetKey);
  if (keyRef.current !== resetKey) {
    keyRef.current = resetKey;
    peakRef.current = 0;
  }
  const clamped = Math.max(0, Math.min(100, percent));
  if (clamped >= peakRef.current) {
    peakRef.current = clamped;
  }
  return peakRef.current;
};
