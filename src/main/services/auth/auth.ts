import { scopedLogger } from '@main/infra/logger';
import { clearStoredAuth, getStoredAuth, setStoredAuth } from '@main/infra/store';
import { type Account, accountFromSession } from '@shared/contracts/account';
import type {
  AuthSession,
  LoginPayload,
  LoginResult,
  YggdrasilSession,
} from '@shared/contracts/auth';
import type { MojangAuth } from './mojangAuth';
import { enrichYggdrasilAccount, verifySession } from './verify';
import type { YggdrasilAuth } from './yggdrasilAuth';
import type { FetchTextures } from './yggdrasilClient';

const logger = scopedLogger('auth');

// Single visible point where a freshly authenticated session becomes the
// renderer-facing account. Yggdrasil textures live behind a separate endpoint
// and need enrichment; the Microsoft/Mojang session already embeds the active
// skin and exposes no cape API, so its account is returned without a fetch.
export const buildLoginResult = async (
  session: AuthSession,
  fetchTextures: FetchTextures,
): Promise<LoginResult> => {
  const account = accountFromSession(session);
  if (session.provider === 'yggdrasil') {
    return { ok: true, user: await enrichYggdrasilAccount(session, account, fetchTextures) };
  }
  return { ok: true, user: account };
};

export const login = async (
  yggdrasilAuth: YggdrasilAuth,
  payload: LoginPayload,
  fetchTextures: FetchTextures,
): Promise<LoginResult> => {
  const result = await yggdrasilAuth.signIn(payload);
  if (!result.ok) return result;
  setStoredAuth(result.session);
  return buildLoginResult(result.session, fetchTextures);
};

export const fetchCurrentUser = (
  yggdrasilAuth: YggdrasilAuth,
  mojangAuth: MojangAuth,
  fetchTextures: FetchTextures,
): Promise<Account | null> => verifySession(yggdrasilAuth, mojangAuth, fetchTextures);

const invalidateYggdrasilSession = (
  yggdrasilAuth: YggdrasilAuth,
  session: YggdrasilSession,
): void => {
  // Server invalidation is best-effort; local sign-out has already completed.
  void yggdrasilAuth
    .signOut(session)
    .catch((error: unknown) =>
      logger.warn('Yggdrasil sign-out cleanup failed after local logout', error),
    );
};

export const logout = (yggdrasilAuth: YggdrasilAuth): Promise<void> => {
  const session = getStoredAuth();
  clearStoredAuth();
  if (session?.provider === 'yggdrasil') {
    invalidateYggdrasilSession(yggdrasilAuth, session);
  }
  return Promise.resolve();
};

// Synchronous "what's the active account" probe for callers (e.g. launch
// path) that cannot await the network-touching `fetchCurrentUser`. Returns
// the bare account derived from the stored session; for Yggdrasil sessions
// this leaves `email`/`skin`/`cape` as `null` — the launch composer only
// needs `username`.
export const getStoredAccount = (): Account | null => {
  const session = getStoredAuth();
  return session ? accountFromSession(session) : null;
};
