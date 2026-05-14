import type { Account, LoginPayload, LoginResult } from '@shared/contracts';
import { IPC_CHANNELS } from '@shared/ipc';

export const login = (payload: LoginPayload): Promise<LoginResult> =>
  window.api.invoke(IPC_CHANNELS.authLogin, payload);

export const fetchCurrentUser = (): Promise<Account | null> =>
  window.api.invoke(IPC_CHANNELS.authMe, undefined);

export const logout = (): Promise<void> => window.api.invoke(IPC_CHANNELS.authLogout, undefined);
