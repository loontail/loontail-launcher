import { asClientSlug } from '@shared/contracts/ids';
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

const SLUG = asClientSlug('test-client');

describe('buildMinecraftErrorToast', () => {
  beforeEach(() => {
    apiMocks.repair.mockClear();
  });

  it('attaches a repair action that routes to repair for every repairable code', () => {
    for (const code of REPAIRABLE_ERROR_CODES) {
      const options = buildMinecraftErrorToast(code, SLUG);
      expect(options?.action?.label).toBe('clients.repair');
      options?.action?.onClick();
    }

    expect(apiMocks.repair).toHaveBeenCalledTimes(REPAIRABLE_ERROR_CODES.size);
    expect(apiMocks.repair).toHaveBeenCalledWith(SLUG);
  });

  it('returns no action for non-repairable error codes', () => {
    expect(buildMinecraftErrorToast(MinecraftErrorCodes.NO_ACCOUNT, SLUG)).toBeUndefined();
    expect(buildMinecraftErrorToast(MinecraftErrorCodes.NETWORK_ERROR, SLUG)).toBeUndefined();
    expect(apiMocks.repair).not.toHaveBeenCalled();
  });
});
