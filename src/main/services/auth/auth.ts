import { clearStoredAuth, getStoredAuth, setStoredAuth } from '@main/infra/store';
import { type Account, accountFromSession } from '@shared/contracts/account';
import type { LoginPayload, LoginResult } from '@shared/contracts/auth';
import type { MojangAuth } from './mojangAuth';
import { enrichYggdrasilAccount, verifySession } from './verify';
import type { YggdrasilAuth } from './yggdrasilAuth';

export const login = async (
  yggdrasilAuth: YggdrasilAuth,
  payload: LoginPayload,
): Promise<LoginResult> => {
  const result = await yggdrasilAuth.signIn(payload);
  if (!result.ok) return result;
  setStoredAuth(result.session);
  const account = await enrichYggdrasilAccount(result.session, accountFromSession(result.session));
  return { ok: true, user: account };
};

export const fetchCurrentUser = (
  yggdrasilAuth: YggdrasilAuth,
  mojangAuth: MojangAuth,
): Promise<Account | null> => verifySession(yggdrasilAuth, mojangAuth);

export const logout = async (yggdrasilAuth: YggdrasilAuth): Promise<void> => {
  const session = getStoredAuth();
  if (session?.provider === 'yggdrasil') {
    await yggdrasilAuth.signOut(session);
  }
  clearStoredAuth();
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
