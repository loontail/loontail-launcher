import { IPC_CHANNELS } from '@shared/ipc';

export const openConsoleWindow = (): void => {
  void window.api.invoke(IPC_CHANNELS.consoleOpen, undefined);
};
