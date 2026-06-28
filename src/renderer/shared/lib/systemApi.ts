import { IPC_CHANNELS } from '@shared/ipc';

// Goes through main because `navigator.clipboard.writeText` is denied by
// Electron's default permission handler in this app.
export const copyText = (text: string): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.systemCopyText, text);
