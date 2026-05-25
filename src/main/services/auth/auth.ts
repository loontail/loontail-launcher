import { clearStoredAuth, getStoredAuth, setStoredAuth } from '@main/infra/store';
import { type Account, accountFromSession } from '@shared/contracts/account';
import type { LoginPayload, LoginResult } from '@shared/contracts/auth';
import type { MojangAuth } from './mojangAuth';
import { loginStrapi } from './strapiAuth';
import { verifySession } from './verify';

export const login = async (payload: LoginPayload): Promise<LoginResult> => {
  const result = await loginStrapi(payload);
  if (!result.ok) return result;
  setStoredAuth(result.session);
  return { ok: true, user: accountFromSession(result.session) };
};

export const fetchCurrentUser = (mojangAuth: MojangAuth): Promise<Account | null> =>
  verifySession(mojangAuth);

export const logout = (): void => {
  clearStoredAuth();
};

export const getStoredAccount = (): Account | null => {
  const session = getStoredAuth();
  return session ? accountFromSession(session) : null;
};
