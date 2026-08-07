import type { IpcError } from '@shared/ipc';
import { describe, expect, it, vi } from 'vitest';

// onError runs outside React, so the localizers read the global i18n instance.
// Key-echo so each assertion reads the resolved i18n key directly.
vi.mock('@renderer/i18n', () => ({
  i18n: { t: (key: string) => key },
}));

import { localizeBundleError } from '@renderer/features/bundle/errorCopy';
import { localizeMinecraftError } from '@renderer/features/minecraft/errorCopy';
import { i18n } from '@renderer/i18n';
import { resolveErrorToastMessage } from '@renderer/shared/lib/errorToast';

const ipcError = (code: string, message: string): IpcError => ({ code, message });
const minecraftLocalizer = (error: IpcError) =>
  localizeMinecraftError(error.code, error.message, i18n.t);
const bundleLocalizer = (error: IpcError) => localizeBundleError(error.code, error.message, i18n.t);

describe('resolveErrorToastMessage', () => {
  it('localizes a coded IpcError with its mutation localizer', () => {
    expect(
      resolveErrorToastMessage(
        ipcError('minecraft/noAccount', 'Sign in first'),
        minecraftLocalizer,
      ),
    ).toBe('builds.error.noAccount');
    expect(
      resolveErrorToastMessage(ipcError('bundle/manifestFetchFailed', 'offline'), bundleLocalizer),
    ).toBe('builds.bundleError.manifestFetchFailed');
  });

  it('falls back to the domain unknown key for an unrecognized code', () => {
    expect(resolveErrorToastMessage(ipcError('NOT_A_REAL_CODE', 'boom'), minecraftLocalizer)).toBe(
      'builds.error.unknown',
    );
  });

  it('uses formatError for an un-coded Error', () => {
    expect(resolveErrorToastMessage(new Error('raw failure'), minecraftLocalizer)).toBe(
      'raw failure',
    );
  });

  it('uses formatError when no localizer is provided', () => {
    expect(
      resolveErrorToastMessage(ipcError('minecraft/noAccount', 'Sign in first'), undefined),
    ).toBe('Sign in first');
  });
});
