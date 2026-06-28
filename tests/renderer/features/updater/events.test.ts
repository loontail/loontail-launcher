import { UpdaterStates, type UpdaterStatusEvent } from '@shared/contracts/updater';
import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@renderer/shared/ui/Toast', () => ({ toast: toastMock }));

import {
  handleUpdaterStatus,
  markUserInitiatedCheck,
  useUpdaterCheckTracking,
} from '@renderer/features/updater/events';

// Echoes the key with any interpolated message so toast assertions can read it.
const t = ((key: string, opts?: { message?: string }) =>
  opts?.message ? `${key}:${opts.message}` : key) as unknown as TFunction;

const newDedup = () => ({ state: null as string | null, errorMessage: null as string | null });

const TIMEOUT_ERROR: UpdaterStatusEvent = {
  state: UpdaterStates.ERROR,
  message: 'Update check timed out',
};

beforeEach(() => {
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.info.mockClear();
  toastMock.warn.mockClear();
  useUpdaterCheckTracking.getState().reset();
});

describe('updater check tracking store', () => {
  it('starts clean and resets the user-initiated flag and dedupe clock', () => {
    markUserInitiatedCheck();
    expect(useUpdaterCheckTracking.getState().userInitiatedCheck).toBe(true);
    expect(useUpdaterCheckTracking.getState().claimAutoCheck(0)).toBe(true);

    useUpdaterCheckTracking.getState().reset();

    expect(useUpdaterCheckTracking.getState().userInitiatedCheck).toBe(false);
    expect(useUpdaterCheckTracking.getState().lastAutoCheckAt).toBe(Number.NEGATIVE_INFINITY);
  });

  it('debounces auto-checks within the dedupe window from store state', () => {
    const { claimAutoCheck } = useUpdaterCheckTracking.getState();
    expect(claimAutoCheck(0)).toBe(true);
    expect(claimAutoCheck(4_999)).toBe(false);
    expect(claimAutoCheck(5_000)).toBe(true);
  });
});

describe('handleUpdaterStatus', () => {
  it('confirms "up to date" only for a user-initiated check', () => {
    const dedup = newDedup();
    handleUpdaterStatus({ state: UpdaterStates.NOT_AVAILABLE }, t, dedup);
    expect(toastMock.success).not.toHaveBeenCalled();

    markUserInitiatedCheck();
    handleUpdaterStatus({ state: UpdaterStates.NOT_AVAILABLE }, t, dedup);
    expect(toastMock.success).toHaveBeenCalledWith('updater.toast.notAvailable');
  });

  it('clears the user-initiated flag on any terminal state', () => {
    markUserInitiatedCheck();
    handleUpdaterStatus({ state: UpdaterStates.NOT_AVAILABLE }, t, newDedup());
    expect(useUpdaterCheckTracking.getState().userInitiatedCheck).toBe(false);
  });

  it('clears the user-initiated flag when the watchdog timeout ERROR arrives', () => {
    markUserInitiatedCheck();
    handleUpdaterStatus(TIMEOUT_ERROR, t, newDedup());
    expect(useUpdaterCheckTracking.getState().userInitiatedCheck).toBe(false);
  });

  // The double-mount scenario: a second listener instance shares the same store,
  // so its dedupe ref is fresh but the user-initiated flag is the single source
  // of truth. After a stalled check times out (watchdog ERROR), a late
  // background NOT_AVAILABLE must NOT pop a success toast.
  it('does not emit a success toast after a stall + watchdog clears the flag', () => {
    const firstMount = newDedup();
    const secondMount = newDedup();

    markUserInitiatedCheck();
    // Stall: only CHECKING arrives, then the main-side watchdog fires.
    handleUpdaterStatus({ state: UpdaterStates.CHECKING }, t, firstMount);
    handleUpdaterStatus(TIMEOUT_ERROR, t, firstMount);
    expect(toastMock.error).toHaveBeenCalledWith('updater.toast.error:Update check timed out');

    toastMock.success.mockClear();
    // A late background poll resolves on the second mount's dedupe ref.
    handleUpdaterStatus({ state: UpdaterStates.NOT_AVAILABLE }, t, secondMount);

    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
