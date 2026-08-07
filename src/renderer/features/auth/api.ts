import type { Account, LoginPayload } from '@shared/contracts';
import { IPC_CHANNELS } from '@shared/ipc';

export const login = (payload: LoginPayload): Promise<Account> =>
  window.api.invoke(IPC_CHANNELS.authLogin, payload);

export const fetchCurrentUser = (): Promise<Account | null> =>
  window.api.invoke(IPC_CHANNELS.authMe, undefined);

export const logout = (): Promise<void> => window.api.invoke(IPC_CHANNELS.authLogout, undefined);

// Blocks for the entire browser sign-in flow (open browser → loopback callback → code exchange).
export const signInWithMojang = (): Promise<Account> =>
  window.api.invoke(IPC_CHANNELS.authMojangSignIn, undefined);

export const cancelMojangLogin = (): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.authMojangCancel, undefined);
