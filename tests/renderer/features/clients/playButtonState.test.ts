import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    },
  });
});

import {
  PlayButtonActions,
  selectPlayButtonAction,
} from '@renderer/features/clients/components/PlayButton';
import { BundleSyncStatuses } from '@shared/contracts/bundle';
import { InstallStatuses } from '@shared/contracts/minecraft';

const select = (overrides: Partial<Parameters<typeof selectPlayButtonAction>[0]> = {}) =>
  selectPlayButtonAction({
    status: InstallStatuses.INSTALLED,
    hasProgress: false,
    hasBundle: true,
    bundleStatus: BundleSyncStatuses.UNKNOWN,
    bundleInstalled: true,
    bundleSignatureMatches: true,
    hasBundleError: false,
    isChecking: false,
    ...overrides,
  });

describe('selectPlayButtonAction', () => {
  it('surfaces a stale installed bundle as an update action', () => {
    expect(select({ bundleSignatureMatches: false })).toBe(PlayButtonActions.BUNDLE_UPDATE);
  });

  it('keeps stale bundle state separate from bundle sync errors', () => {
    expect(
      select({
        bundleStatus: BundleSyncStatuses.ERROR,
        hasBundleError: true,
        bundleSignatureMatches: false,
      }),
    ).toBe(PlayButtonActions.BUNDLE_ERROR);
  });

  it('does not hide a Minecraft error behind a bundle error', () => {
    expect(
      select({
        status: InstallStatuses.ERROR,
        bundleStatus: BundleSyncStatuses.ERROR,
        hasBundleError: true,
      }),
    ).toBe(PlayButtonActions.ERROR);
  });

  it('surfaces failed repair status as an error action', () => {
    expect(
      select({
        status: InstallStatuses.ERROR,
        hasBundle: false,
        bundleInstalled: false,
      }),
    ).toBe(PlayButtonActions.ERROR);
  });

  it('surfaces unverified installs as retry instead of plain play', () => {
    expect(select({ status: InstallStatuses.UNVERIFIED })).toBe(PlayButtonActions.UNVERIFIED);
  });

  it('does not expose initial unknown status as checking or download', () => {
    expect(select({ status: InstallStatuses.UNKNOWN })).toBe(PlayButtonActions.STATUS_PENDING);
  });

  it('shows a dedicated repair state while repair is verifying before downloads', () => {
    expect(select({ status: InstallStatuses.REPAIRING })).toBe(PlayButtonActions.REPAIRING);
  });

  it('shows a status-check spinner while launch preflight is pending', () => {
    expect(select({ isChecking: true })).toBe(PlayButtonActions.CHECKING);
  });

  it('does not show launch checking for non-play statuses', () => {
    expect(select({ status: InstallStatuses.NOT_INSTALLED, isChecking: true })).toBe(
      PlayButtonActions.INSTALL,
    );
  });

  it('shows a spinner while install is still planning (no bytes yet)', () => {
    expect(select({ status: InstallStatuses.INSTALLING, hasProgress: false })).toBe(
      PlayButtonActions.CHECKING,
    );
  });

  it('shows a spinner while a bundle sync is busy before downloading', () => {
    for (const bundleStatus of [
      BundleSyncStatuses.FETCHING_MANIFEST,
      BundleSyncStatuses.PLANNING,
      BundleSyncStatuses.DELETING,
      BundleSyncStatuses.HEALING,
    ]) {
      expect(select({ bundleStatus })).toBe(PlayButtonActions.CHECKING);
    }
  });

  it('still renders the download card when a bundle is actively downloading', () => {
    expect(select({ bundleStatus: BundleSyncStatuses.DOWNLOADING, hasProgress: true })).toBe(
      PlayButtonActions.PROGRESS,
    );
  });
});
