import { asCatalogKey } from '@shared/contracts/ids';
import { MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  repair: vi.fn(() => Promise.resolve()),
}));

vi.mock('@renderer/i18n', () => ({
  i18n: { t: (key: string) => key },
}));

vi.mock('@renderer/features/minecraft/api', () => ({
  repair: apiMocks.repair,
}));

import {
  REPAIRABLE_ERROR_CODES,
  buildMinecraftErrorToast,
} from '@renderer/features/minecraft/events';

const SLUG = asCatalogKey('official:test-client');

describe('buildMinecraftErrorToast', () => {
  beforeEach(() => {
    apiMocks.repair.mockClear();
  });

  it('builds a friendly warn prompt with a repair action for every repairable code', () => {
    for (const code of REPAIRABLE_ERROR_CODES) {
      const built = buildMinecraftErrorToast(code, SLUG, 'raw error detail');
      // A calm "heads up", never a red error, and never the raw error text.
      expect(built.variant).toBe('warn');
      expect(built.message).toBe('clients.repairOffer');
      expect(built.action?.label).toBe('clients.repair');
      built.action?.onClick();
    }

    expect(apiMocks.repair).toHaveBeenCalledTimes(REPAIRABLE_ERROR_CODES.size);
    expect(apiMocks.repair).toHaveBeenCalledWith(SLUG);
  });

  it('builds a plain error toast with the localized message for non-repairable codes', () => {
    const noAccount = buildMinecraftErrorToast(MinecraftErrorCodes.NO_ACCOUNT, SLUG, 'x');
    expect(noAccount.variant).toBe('error');
    expect(noAccount.message).toBe('clients.error.noAccount');
    expect(noAccount.action).toBeUndefined();

    const network = buildMinecraftErrorToast(MinecraftErrorCodes.NETWORK_ERROR, SLUG, 'x');
    expect(network.variant).toBe('error');
    expect(network.action).toBeUndefined();

    expect(apiMocks.repair).not.toHaveBeenCalled();
  });
});
