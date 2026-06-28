import {
  clearStoredAuth,
  getStoredAuth,
  getStoredSessionToken,
  setStoredAuth,
} from '@main/infra/store';
import { type Account, accountFromSession } from '@shared/contracts/account';
import type {
  AuthSession,
  LoginPayload,
  LoginResult,
  RegisterPayload,
} from '@shared/contracts/auth';
import type { AuthenticatedIdentity, LoontailAuth, LoontailAuthResult } from './loontailAuth';
import type { MojangAuth } from './mojangAuth';
import { enrichYggdrasilAccount, verifySession } from './verify';
import type { FetchTextures } from './yggdrasilClient';

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

// Persist the authenticated identity (Yggdrasil session + API bearer) and return
// the renderer-facing account, enriching it with the live texture URLs. The
// account from the login response already carries the email; only skin/cape need
// a textures fetch.
const completeAuthentication = async (
  identity: AuthenticatedIdentity,
  fetchTextures: FetchTextures,
): Promise<LoginResult> => {
  setStoredAuth(identity.session, identity.sessionToken);
  const enriched = await enrichYggdrasilAccount(identity.session, identity.account, fetchTextures);
  return { ok: true, user: enriched };
};

const handleAuthResult = (
  result: LoontailAuthResult,
  fetchTextures: FetchTextures,
): Promise<LoginResult> => {
  if (!result.ok) return Promise.resolve(result);
  return completeAuthentication(result.identity, fetchTextures);
};

export const login = async (
  loontailAuth: LoontailAuth,
  payload: LoginPayload,
  fetchTextures: FetchTextures,
): Promise<LoginResult> => handleAuthResult(await loontailAuth.signIn(payload), fetchTextures);

export const register = async (
  loontailAuth: LoontailAuth,
  payload: RegisterPayload,
  fetchTextures: FetchTextures,
): Promise<LoginResult> => handleAuthResult(await loontailAuth.register(payload), fetchTextures);

export const fetchCurrentUser = (
  loontailAuth: LoontailAuth,
  mojangAuth: MojangAuth,
  fetchTextures: FetchTextures,
): Promise<Account | null> => verifySession(loontailAuth, mojangAuth, fetchTextures);

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

// Synchronous "what's the active account" probe for callers (e.g. launch
// path) that cannot await the network-touching `fetchCurrentUser`. Returns
// the bare account derived from the stored session; for Yggdrasil sessions
// this leaves `email`/`skin`/`cape` as `null` — the launch composer only
// needs `username`.
export const getStoredAccount = (): Account | null => {
  const session = getStoredAuth();
  return session ? accountFromSession(session) : null;
};
