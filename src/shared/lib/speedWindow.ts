// A rolling-window byte-rate sampler shared by the main install/repair progress
// adapter and the renderer's repair-speed hook (cross-process, so this module
// stays dependency-free). Each `sample(value, nowMs)` records a cumulative byte
// count and returns the average bytes/sec over the trailing `windowMs`:
//
//   * A whole-window average (first→last over the retained samples) smooths the
//     install kit's per-second jitter, keeping the speed/ETA readout steady.
//   * A backward jump in `value` (resume after pause, stage restart at 0%, or a
//     replan) resets the window so the rate never dips negative and then
//     recovers slowly — it restarts cleanly from the new baseline.
//   * Samples older than `windowMs` are pruned each tick.
//
// The returned rate is the raw (unrounded) bytes/sec; callers round/clamp as
// they need. `reset()` drops all samples (e.g. on a stage boundary).
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
