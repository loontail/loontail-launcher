import { IPC_CHANNELS } from '@shared/ipc';

export const getLastPlayed = (): Promise<Record<string, number>> =>
  window.api.invoke(IPC_CHANNELS.historyLastPlayed, undefined);
