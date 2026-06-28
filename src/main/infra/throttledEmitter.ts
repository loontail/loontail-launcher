import { PROGRESS_THROTTLE_MS } from '@shared/constants';

export type ThrottledEmitter<T> = {
  readonly push: (value: T) => void;
  readonly dispose: () => void;
};

// Leading-edge throttle with a trailing flush: pushes within `intervalMs` are
// coalesced to the latest value. `dispose` flushes any pending value so the final
// update is never dropped on teardown.
export const createThrottledEmitter = <T>(
  emit: (value: T) => void,
  intervalMs: number = PROGRESS_THROTTLE_MS,
): ThrottledEmitter<T> => {
  let pendingValue: T | null = null;
  let hasPending = false;
  let lastEmittedAt = 0;
  let timer: NodeJS.Timeout | null = null;

  const clearTimer = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const flush = (): void => {
    clearTimer();
    if (!hasPending) return;
    lastEmittedAt = Date.now();
    const value = pendingValue as T;
    hasPending = false;
    pendingValue = null;
    emit(value);
  };

  return {
    push: (value) => {
      pendingValue = value;
      hasPending = true;
      const elapsed = Date.now() - lastEmittedAt;
      if (elapsed >= intervalMs) {
        flush();
      } else if (timer === null) {
        timer = setTimeout(flush, intervalMs - elapsed);
        if (typeof timer.unref === 'function') timer.unref();
      }
    },
    dispose: flush,
  };
};
