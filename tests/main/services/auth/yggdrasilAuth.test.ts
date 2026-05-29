import type { YggdrasilClient } from '@loontail/yggdrasil-client';
import { createYggdrasilAuth } from '@main/services/auth/yggdrasilAuth';
import type { YggdrasilSession } from '@shared/contracts/auth';
import { describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => loggerMocks,
}));

const yggdrasilSession = (): YggdrasilSession => ({
  provider: 'yggdrasil',
  accessToken: 'access-token',
  clientToken: 'client-token',
  profile: { uuid: '0123456789abcdef0123456789abcdef', name: 'someone' },
});

const yggdrasilClient = (
  overrides: Partial<Pick<YggdrasilClient, 'invalidate'>> = {},
): YggdrasilClient =>
  ({
    authenticate: vi.fn(),
    validate: vi.fn(),
    refresh: vi.fn(),
    invalidate: overrides.invalidate ?? vi.fn().mockResolvedValue(undefined),
  }) as unknown as YggdrasilClient;

describe('createYggdrasilAuth.signOut', () => {
  it('logs invalidate failures as warnings and resolves', async () => {
    const error = new Error('network down');
    const invalidate = vi.fn().mockRejectedValue(error);
    const auth = createYggdrasilAuth(yggdrasilClient({ invalidate }));

    await expect(auth.signOut(yggdrasilSession())).resolves.toBeUndefined();

    expect(invalidate).toHaveBeenCalledWith({
      accessToken: 'access-token',
      clientToken: 'client-token',
    });
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('Yggdrasil invalidate failed'),
      error,
    );
  });
});
