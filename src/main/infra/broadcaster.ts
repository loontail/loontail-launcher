import { type IpcEventPayloads, emit } from '@shared/ipc';
import type { BrowserWindow } from 'electron';

type EventChannel = keyof IpcEventPayloads;

type BroadcasterChannels = {
  readonly status: EventChannel;
  readonly progress: EventChannel;
  readonly error: EventChannel;
};

type Broadcaster<TChannels extends BroadcasterChannels> = {
  status: (payload: IpcEventPayloads[TChannels['status']]) => void;
  progress: (payload: IpcEventPayloads[TChannels['progress']]) => void;
  error: (payload: IpcEventPayloads[TChannels['error']]) => void;
};

// Build a {status, progress, error} broadcaster bound to a feature's three IPC
// channels. `getWindow` resolves the live main window on each send: it can be
// recreated (macOS dock re-open after the window was closed) and a captured
// reference would broadcast into the destroyed original.
export const makeBroadcaster = <TChannels extends BroadcasterChannels>(
  getWindow: () => BrowserWindow,
  channels: TChannels,
): Broadcaster<TChannels> => ({
  status: (payload) => {
    emit(getWindow(), channels.status, payload);
  },
  progress: (payload) => {
    emit(getWindow(), channels.progress, payload);
  },
  error: (payload) => {
    emit(getWindow(), channels.error, payload);
  },
});
