import { useEffect, useRef, useState } from 'react';

const WINDOW_MS = 3000;

// Moving-average bytes/sec derived from successive `bytes` snapshots.
// Used when the producing runner doesn't already report throughput (the
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
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (first && last && samples.length >= 2) {
      const dt = (last[0] - first[0]) / 1000;
      if (dt > 0) setSpeed((last[1] - first[1]) / dt);
    }
  }, [bytes, active]);

  return speed;
};
