import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@main/config', () => ({
  mainConfig: { apiUrl: 'https://api.test.invalid' },
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => loggerMocks,
}));

import {
  AuthApiError,
  createAuthApi,
  isAuthCredentialRejection,
} from '@main/services/auth/authApi';

const fetchMock = vi.fn();

const envelope = (code: string, message: string, status: number): Response =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const registerCall = (): Promise<unknown> =>
  createAuthApi().register({ username: 'taken', email: 'a@b.c', password: 'hunter22' });

describe('createAuthApi error decoding', () => {
  it('carries the server code and message from the error envelope', async () => {
    fetchMock.mockResolvedValue(envelope('conflict', "username 'taken' is already taken", 409));

    const error = await registerCall().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AuthApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'conflict',
      serverMessage: "username 'taken' is already taken",
    });
    expect((error as Error).message).toContain('conflict');
    expect((error as Error).message).toContain("username 'taken' is already taken");
  });

  it('falls back to a bounded preview when the body is not the envelope', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html><body>502 Bad Gateway</body></html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const error = (await registerCall().catch((err: unknown) => err)) as AuthApiError;

    expect(error.code).toBeNull();
    expect(error.serverMessage).toBeNull();
    expect(error.message).toContain('502 Bad Gateway');
  });

  it('does not parse an unbounded error body', async () => {
    const huge = `{"error":{"code":"x","message":"${'y'.repeat(8192)}"}}`;
    fetchMock.mockResolvedValue(new Response(huge, { status: 500 }));

    const error = (await registerCall().catch((err: unknown) => err)) as AuthApiError;

    expect(error.code).toBeNull();
    expect(error.message.length).toBeLessThan(400);
  });

  it('tolerates a JSON body that is not an error envelope', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: 'nope' }), { status: 400 }));

    const error = (await registerCall().catch((err: unknown) => err)) as AuthApiError;

    expect(error.code).toBeNull();
    expect(error.message).toContain('nope');
  });

  it('still classifies a 401 as a credential rejection when it carries an envelope', async () => {
    fetchMock.mockResolvedValue(envelope('unauthorized', 'invalid credentials', 401));

    const error = await createAuthApi()
      .login({ username: 'someone', password: 'wrong' })
      .catch((err: unknown) => err);

    expect(isAuthCredentialRejection(error)).toBe(true);
  });
});
