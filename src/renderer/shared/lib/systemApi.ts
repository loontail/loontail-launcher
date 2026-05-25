import { IPC_CHANNELS } from '@shared/ipc';

// Writes via main-process `clipboard.writeText`. `navigator.clipboard.writeText`
// is denied by Electron's default permission handler in this app, so going
// through main is the path that actually works.
export const copyText = (text: string): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.systemCopyText, text);
