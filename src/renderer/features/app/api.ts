import { IPC_CHANNELS } from '@shared/ipc';

export const getAppVersion = (): Promise<string> =>
  window.api.invoke(IPC_CHANNELS.appGetVersion, undefined);
