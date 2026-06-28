import type { IpcEventPayloads } from './contract';

// Structural slice of Electron's BrowserWindow so this shared helper does not
// pull an electron type dependency into the renderer build (which never imports
// electron). Main-side callers pass a real BrowserWindow, which satisfies it.
type EmitTarget = {
  isDestroyed(): boolean;
  webContents: { send(channel: string, payload: unknown): void };
};

// Single typed gateway for every main→renderer push. Binding the event channel
// to its payload type (`IpcEventPayloads[TEvent]`) makes a wrong channel/payload
// pairing a tsc error instead of a silently mismatched wire shape. The destroyed
// guard and the swallow-on-teardown catch fold the per-callsite boilerplate that
// the broadcasters, notifier, and console sink each previously open-coded.
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
