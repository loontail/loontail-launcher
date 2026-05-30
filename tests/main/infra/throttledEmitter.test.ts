import { createThrottledEmitter } from '@main/infra/throttledEmitter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const INTERVAL_MS = 100;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createThrottledEmitter', () => {
  it('emits the first push immediately', () => {
    const emit = vi.fn();
    const emitter = createThrottledEmitter<number>(emit, INTERVAL_MS);

    emitter.push(1);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(1);
  });

  it('defers pushes within the interval and emits only the latest value', () => {
    const emit = vi.fn();
    const emitter = createThrottledEmitter<number>(emit, INTERVAL_MS);
    emitter.push(1);
    emit.mockClear();

    emitter.push(2);
    emitter.push(3);
    expect(emit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(INTERVAL_MS);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(3);
  });

  it('flushes the pending value on dispose and cancels the timer', () => {
    const emit = vi.fn();
    const emitter = createThrottledEmitter<number>(emit, INTERVAL_MS);
    emitter.push(1);
    emit.mockClear();
    emitter.push(2);

    emitter.dispose();

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(2);

    vi.advanceTimersByTime(INTERVAL_MS * 2);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('does not emit on dispose when nothing is pending', () => {
    const emit = vi.fn();
    const emitter = createThrottledEmitter<number>(emit, INTERVAL_MS);
    emitter.push(1);
    vi.advanceTimersByTime(INTERVAL_MS);
    emit.mockClear();

    emitter.dispose();

    expect(emit).not.toHaveBeenCalled();
  });
});
