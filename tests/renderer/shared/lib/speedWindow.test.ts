import { createSpeedWindow } from '@renderer/shared/lib/speedWindow';
import { describe, expect, it } from 'vitest';

describe('createSpeedWindow', () => {
  it('returns 0 from the first sample (no prior point to measure against)', () => {
    const w = createSpeedWindow(4000);
    expect(w.sample(0, 0)).toBe(0);
  });

  it('averages bytes/sec across the retained window', () => {
    // 4 KB gained over 4s -> 1 KB/s, regardless of intra-window jitter.
    const w = createSpeedWindow(5000);
    w.sample(0, 0);
    w.sample(100, 1000);
    w.sample(4000, 2000);
    expect(w.sample(4096, 4000)).toBeCloseTo(1024, 0);
  });

  it('drops samples older than the window so a past burst does not skew the rate', () => {
    // The old burst falls outside the 3s window; only the steady tail counts.
    const w = createSpeedWindow(3000);
    w.sample(0, 0);
    w.sample(1_000_000, 1000);
    w.sample(1_003_072, 2000);
    expect(w.sample(1_006_144, 5000)).toBeCloseTo(1024, 0);
  });

  it('resets to 0 on a backward jump and restarts cleanly', () => {
    const w = createSpeedWindow(4000);
    w.sample(0, 0);
    w.sample(2048, 1000);
    // Backward jump (resume/replan) drops the window and yields 0.
    expect(w.sample(0, 2000)).toBe(0);
    // The rate rebuilds from the new baseline, not the old samples.
    expect(w.sample(1024, 3000)).toBeCloseTo(1024, 0);
  });

  it('reset() drops all samples so the next sample reads 0', () => {
    const w = createSpeedWindow(4000);
    w.sample(0, 0);
    w.sample(2048, 1000);
    w.reset();
    expect(w.sample(5000, 2000)).toBe(0);
  });

  it('never returns a negative rate', () => {
    const w = createSpeedWindow(4000);
    w.sample(1000, 0);
    // A non-monotone-but-not-backward case never produces a negative rate.
    expect(w.sample(1000, 1000)).toBe(0);
  });
});
