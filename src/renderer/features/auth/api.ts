import type { Account, LoginPayload, LoginResult, RegisterPayload } from '@shared/contracts';
import { IPC_CHANNELS } from '@shared/ipc';

export const login = (payload: LoginPayload): Promise<LoginResult> =>
  window.api.invoke(IPC_CHANNELS.authLogin, payload);

export const register = (payload: RegisterPayload): Promise<LoginResult> =>
  window.api.invoke(IPC_CHANNELS.authRegister, payload);

export const fetchCurrentUser = (): Promise<Account | null> =>
  window.api.invoke(IPC_CHANNELS.authMe, undefined);

export const logout = (): Promise<void> => window.api.invoke(IPC_CHANNELS.authLogout, undefined);

// Blocks for the entire browser sign-in flow: main opens the system browser,
// waits for the loopback callback, exchanges the code, and returns the
// resulting account (or the failure code).
export const signInWithMojang = (): Promise<LoginResult> =>
  window.api.invoke(IPC_CHANNELS.authMojangSignIn, undefined);

export const cancelMojangLogin = (): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.authMojangCancel, undefined);
