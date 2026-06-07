import { useEffect, useRef, useState } from 'react';
import { rollingSpeed } from './progressFormat';

// 4s rolling window — wide enough to smooth the install kit's per-second jitter,
// short enough to react to a genuine slowdown within a few ticks.
const WINDOW_MS = 4000;

// Smoothed bytes/sec derived from successive `bytes` snapshots over a rolling
// window. Used when the producing runner doesn't already report throughput (the
// install kit emits cumulative byte counts but no rate).
//
// A backwards jump (resume after pause, or replanning) resets the window so
// the rate doesn't dip negative and recover slowly.
export const useByteSpeed = (bytes: number | undefined, active: boolean): number => {
  const samplesRef = useRef<Array<[number, number]>>([]);
  const [speed, setSpeed] = useState(0);

  useEffect(() => {
    if (!active || bytes === undefined) {
      samplesRef.current = [];
      setSpeed(0);
      return;
    }
    const now = Date.now();
    const samples = samplesRef.current;
    const prev = samples[samples.length - 1];
    if (prev && bytes < prev[1]) {
      samplesRef.current = [[now, bytes]];
      setSpeed(0);
      return;
    }
    samples.push([now, bytes]);
    while (samples.length > 0) {
      const head = samples[0];
      if (!head || now - head[0] <= WINDOW_MS) break;
      samples.shift();
    }
    setSpeed(rollingSpeed(samples, now, WINDOW_MS));
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
