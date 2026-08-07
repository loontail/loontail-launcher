import {
  clearStoredAuth,
  getStoredAuth,
  getStoredSessionToken,
  setStoredAuth,
} from '@main/infra/store';
import { type Account, accountFromSession } from '@shared/contracts/account';
import type { AuthSession, LoginPayload, RegisterPayload } from '@shared/contracts/auth';
import { AuthError } from './errors';
import type {
  AuthenticatedIdentity,
  LoontailAuth,
  LoontailAuthResult,
  ValidateSession,
} from './loontailAuth';
import type { MojangAuth } from './mojangAuth';
import type { SessionRefresher } from './sessionRefresh';
import { enrichYggdrasilAccount, verifySession } from './verify';
import type { FetchTextures } from './yggdrasilClient';

// Yggdrasil textures live behind a separate endpoint and need enrichment; a
// Microsoft/Mojang session already embeds the active skin (and has no cape API),
// so its account is returned without a fetch.
export const buildAccount = async (
  session: AuthSession,
  fetchTextures: FetchTextures,
): Promise<Account> => {
  const account = accountFromSession(session);
  if (session.provider === 'yggdrasil') {
    return enrichYggdrasilAccount(session, account, fetchTextures);
  }
  return account;
};

// Persist the identity, then enrich the account with live texture URLs; the
// login response already carries the email, so only skin/cape need a fetch.
const completeAuthentication = async (
  identity: AuthenticatedIdentity,
  fetchTextures: FetchTextures,
): Promise<Account> => {
  setStoredAuth(identity.session, identity.apiSession);
  return enrichYggdrasilAccount(identity.session, identity.account, fetchTextures);
};

// A rejected credential leaves the bridge the same way every other failure does:
// as a coded rejection, so a caller needs one error path instead of two.
const handleAuthResult = (
  result: LoontailAuthResult,
  fetchTextures: FetchTextures,
): Promise<Account> => {
  if (!result.ok) throw new AuthError(result.error, 'Sign-in failed');
  return completeAuthentication(result.identity, fetchTextures);
};

export const login = async (
  loontailAuth: LoontailAuth,
  payload: LoginPayload,
  fetchTextures: FetchTextures,
): Promise<Account> => handleAuthResult(await loontailAuth.signIn(payload), fetchTextures);

export const register = async (
  loontailAuth: LoontailAuth,
  payload: RegisterPayload,
  fetchTextures: FetchTextures,
): Promise<Account> => handleAuthResult(await loontailAuth.register(payload), fetchTextures);

export const fetchCurrentUser = (
  refresher: SessionRefresher,
  validateSession: ValidateSession,
  mojangAuth: MojangAuth,
  fetchTextures: FetchTextures,
): Promise<Account | null> => verifySession(refresher, validateSession, mojangAuth, fetchTextures);

export const logout = (loontailAuth: LoontailAuth): Promise<void> => {
  const session = getStoredAuth();
  const sessionToken = getStoredSessionToken();
  clearStoredAuth();
  if (session?.provider === 'yggdrasil' && sessionToken) {
    // Server invalidation is best-effort; local sign-out has already completed.
    void loontailAuth.signOut(sessionToken);
  }
  return Promise.resolve();
};

// Synchronous active-account probe for callers (e.g. the launch path) that
// cannot await the network-touching `fetchCurrentUser`. For Yggdrasil sessions
// this leaves `email`/`skin`/`cape` null — the launch composer only needs
// `username`.
export const getStoredAccount = (): Account | null => {
  const session = getStoredAuth();
  return session ? accountFromSession(session) : null;
};
