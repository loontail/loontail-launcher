// Rolling-window byte-rate sampler, dependency-free so it can run in both the
// main process and the renderer. `sample` takes a cumulative byte count and
// returns the trailing `windowMs` average bytes/sec (unrounded). A backward jump
// in `value` (resume, stage restart, replan) resets the window so the rate never
// goes negative and restarts cleanly from the new baseline.
export type SpeedWindow = {
  sample: (value: number, nowMs: number) => number;
  reset: () => void;
};

export const createSpeedWindow = (windowMs: number): SpeedWindow => {
  let samples: Array<[number, number]> = [];

  const reset = (): void => {
    samples = [];
  };

  const sample = (value: number, nowMs: number): number => {
    const prev = samples[samples.length - 1];
    if (prev && value < prev[1]) {
      samples = [[nowMs, value]];
      return 0;
    }
    samples.push([nowMs, value]);
    while (samples.length > 0) {
      const head = samples[0];
      if (!head || nowMs - head[0] <= windowMs) break;
      samples.shift();
    }
    if (samples.length < 2) return 0;
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!first || !last) return 0;
    const dt = (last[0] - first[0]) / 1000;
    if (dt <= 0) return 0;
    const rate = (last[1] - first[1]) / dt;
    return rate > 0 ? rate : 0;
  };

  return { sample, reset };
};
