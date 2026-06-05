import {
  type YggdrasilClient,
  YggdrasilClientError,
  YggdrasilClientErrorCodes,
} from '@loontail/yggdrasil-client';
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

type ClientMockOverrides = {
  validate?: ReturnType<typeof vi.fn>;
  refresh?: ReturnType<typeof vi.fn>;
  invalidate?: ReturnType<typeof vi.fn>;
};

const yggdrasilClient = (overrides: ClientMockOverrides = {}): YggdrasilClient =>
  ({
    authenticate: vi.fn(),
    validate: overrides.validate ?? vi.fn(),
    refresh: overrides.refresh ?? vi.fn(),
    invalidate: overrides.invalidate ?? vi.fn().mockResolvedValue(undefined),
  }) as unknown as YggdrasilClient;

const rotatedSession = () => ({
  accessToken: 'rotated-access',
  clientToken: 'rotated-client',
  selectedProfile: { id: 'fedcba98765432100123456789abcdef', name: 'someone' },
});

const networkError = () => new YggdrasilClientError(YggdrasilClientErrorCodes.NETWORK, 'offline');
const forbiddenError = () =>
  new YggdrasilClientError(YggdrasilClientErrorCodes.HTTP_ERROR, 'forbidden', {
    context: { status: 403 },
  });
const opaqueError = () =>
  new YggdrasilClientError(YggdrasilClientErrorCodes.INVALID_RESPONSE, 'unexpected');

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

describe('createYggdrasilAuth.verifySession', () => {
  it('returns ok with the same session when validate succeeds', async () => {
    const auth = createYggdrasilAuth(
      yggdrasilClient({ validate: vi.fn().mockResolvedValue(true) }),
    );
    const result = await auth.verifySession(yggdrasilSession());
    expect(result).toMatchObject({ kind: 'ok', session: { accessToken: 'access-token' } });
  });

  it('reports offline when validate hits a network error', async () => {
    const auth = createYggdrasilAuth(
      yggdrasilClient({ validate: vi.fn().mockRejectedValue(networkError()) }),
    );
    expect(await auth.verifySession(yggdrasilSession())).toEqual({ kind: 'offline' });
  });

  it('reports a server error when validate throws a non-network, non-403 error', async () => {
    const auth = createYggdrasilAuth(
      yggdrasilClient({ validate: vi.fn().mockRejectedValue(opaqueError()) }),
    );
    expect(await auth.verifySession(yggdrasilSession())).toEqual({ kind: 'server-error' });
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('server error'),
      expect.anything(),
    );
  });

  it('refreshes into a rotated session when validate reports the token invalid', async () => {
    const auth = createYggdrasilAuth(
      yggdrasilClient({
        validate: vi.fn().mockResolvedValue(false),
        refresh: vi.fn().mockResolvedValue(rotatedSession()),
      }),
    );
    const result = await auth.verifySession(yggdrasilSession());
    expect(result).toMatchObject({
      kind: 'ok',
      session: {
        accessToken: 'rotated-access',
        clientToken: 'rotated-client',
        profile: { name: 'someone' },
      },
    });
  });

  it('reports expired when refresh is forbidden (403)', async () => {
    const auth = createYggdrasilAuth(
      yggdrasilClient({
        validate: vi.fn().mockResolvedValue(false),
        refresh: vi.fn().mockRejectedValue(forbiddenError()),
      }),
    );
    expect(await auth.verifySession(yggdrasilSession())).toEqual({ kind: 'expired' });
  });

  it('reports offline when refresh hits a network error', async () => {
    const auth = createYggdrasilAuth(
      yggdrasilClient({
        validate: vi.fn().mockResolvedValue(false),
        refresh: vi.fn().mockRejectedValue(networkError()),
      }),
    );
    expect(await auth.verifySession(yggdrasilSession())).toEqual({ kind: 'offline' });
  });

  it('treats an opaque refresh failure as expired', async () => {
    const auth = createYggdrasilAuth(
      yggdrasilClient({
        validate: vi.fn().mockResolvedValue(false),
        refresh: vi.fn().mockRejectedValue(opaqueError()),
      }),
    );
    expect(await auth.verifySession(yggdrasilSession())).toEqual({ kind: 'expired' });
    expect(loggerMocks.warn).toHaveBeenCalled();
  });
});
