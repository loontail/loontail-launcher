import { createSpeedWindow, type SpeedWindow } from '@renderer/shared/lib/speedWindow';
import { useEffect, useRef, useState } from 'react';

// Rolling window wide enough to smooth per-second jitter, short enough to track real slowdowns.
const WINDOW_MS = 4000;

// A backwards jump (resume after pause, or replanning) resets the window so the rate
// doesn't dip negative and recover slowly.
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

// Latch a high-water mark so a stage-boundary recompute or replan can't make the bar retreat;
// reset only on a large drop (a clear restart, e.g. the next stage at 0%).
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
