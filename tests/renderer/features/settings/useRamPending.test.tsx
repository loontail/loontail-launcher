// @vitest-environment jsdom
import { useRamPending } from '@renderer/features/settings/hooks/useRamPending';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SAVED_RAM = 2048;
const EDITED_RAM = 4096;

const rejections: unknown[] = [];
const collectRejection = (reason: unknown): void => {
  rejections.push(reason);
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  rejections.length = 0;
  process.on('unhandledRejection', collectRejection);
});

afterEach(() => {
  process.off('unhandledRejection', collectRejection);
  cleanup();
});

describe('useRamPending', () => {
  it('clears the pending value once the save resolves', async () => {
    const persist = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useRamPending({ savedRam: SAVED_RAM, resetKey: 'build', persist }),
    );

    act(() => result.current.setRam(EDITED_RAM));
    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      await result.current.handleSave();
    });

    expect(persist).toHaveBeenCalledWith(EDITED_RAM);
    expect(result.current.isDirty).toBe(false);
  });

  it('keeps the pending value and raises no unhandled rejection when the save fails', async () => {
    const persist = vi.fn(() => Promise.reject(new Error('ipc down')));
    const { result } = renderHook(() =>
      useRamPending({ savedRam: SAVED_RAM, resetKey: 'build', persist }),
    );

    act(() => result.current.setRam(EDITED_RAM));
    // Mirrors the call sites, which fire the handler without awaiting it.
    await act(async () => {
      void result.current.handleSave();
      await flush();
    });
    await flush();

    expect(result.current.ramValue).toBe(EDITED_RAM);
    expect(result.current.isDirty).toBe(true);
    expect(rejections).toEqual([]);
  });

  it('does nothing when there is no pending edit', async () => {
    const persist = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useRamPending({ savedRam: SAVED_RAM, resetKey: 'build', persist }),
    );

    await act(async () => {
      await result.current.handleSave();
    });

    expect(persist).not.toHaveBeenCalled();
  });
});
