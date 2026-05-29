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
});
