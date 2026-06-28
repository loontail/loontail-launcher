import type { IpcEventPayloads } from './contract';

// Structural slice of Electron's BrowserWindow so this shared helper pulls no
// electron type dependency into the renderer build. A real BrowserWindow satisfies it.
type EmitTarget = {
  isDestroyed(): boolean;
  webContents: { send(channel: string, payload: unknown): void };
};

// Typed gateway for every main→renderer push: binding the channel to its payload
// type makes a wrong channel/payload pairing a tsc error rather than a silently
// mismatched wire shape.
export const emit = <TEvent extends keyof IpcEventPayloads>(
  window: EmitTarget | null,
  event: TEvent,
  payload: IpcEventPayloads[TEvent],
): void => {
  if (!window || window.isDestroyed()) return;
  try {
    window.webContents.send(event, payload);
  } catch {
    /* renderer torn down between the destroyed check and the send — drop the push */
  }
};
