import { IPC_CHANNELS } from '@shared/ipc';

export const triggerInstall = (): void => {
  void window.api.invoke(IPC_CHANNELS.updaterInstall, undefined);
};
