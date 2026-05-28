import type {
  ConsoleInitialPayload,
  ConsoleLine,
  ConsoleProcessState,
} from '@shared/contracts/console';
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/ipc';

type Unsubscribe = () => void;

export const getInitial = (): Promise<ConsoleInitialPayload> =>
  window.api.invoke(IPC_CHANNELS.consoleGetInitial, undefined);

export const clear = (): Promise<void> => window.api.invoke(IPC_CHANNELS.consoleClear, undefined);

export const copyAll = (): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.consoleCopyAll, undefined);

export const copyText = (text: string): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.consoleCopyText, text);

export const onLines = (callback: (lines: ConsoleLine[]) => void): Unsubscribe =>
  window.api.on(IPC_EVENTS.consoleLines, callback);

export const onState = (callback: (state: ConsoleProcessState) => void): Unsubscribe =>
  window.api.on(IPC_EVENTS.consoleState, callback);

export const onBufferReset = (callback: () => void): Unsubscribe =>
  window.api.on(IPC_EVENTS.consoleBufferReset, callback);
