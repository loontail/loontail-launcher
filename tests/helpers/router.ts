import type { Router } from '@main/ipc/router';
import type { IpcArgs, IpcContract, IpcResult } from '@shared/ipc';
import type { IpcMainInvokeEvent } from 'electron';

export type StoredHandler = (rawArgs: unknown) => Promise<unknown> | unknown;

const fakeEvent = (): IpcMainInvokeEvent => ({}) as unknown as IpcMainInvokeEvent;

export const createTestRouter = (): { router: Router; handlers: Map<string, StoredHandler> } => {
  const handlers = new Map<string, StoredHandler>();
  const router: Router = {
    handle<TChannel extends keyof IpcContract>(
      channel: TChannel,
      handler: (
        args: IpcArgs<TChannel>,
        event: IpcMainInvokeEvent,
      ) => Promise<IpcResult<TChannel>> | IpcResult<TChannel>,
    ): void {
      handlers.set(channel, (rawArgs) => handler(rawArgs as IpcArgs<TChannel>, fakeEvent()));
    },
    dispose: () => undefined,
  };
  return { router, handlers };
};

// Several routes register synchronous handlers, so a failed parseIpcArgs throws
// synchronously rather than producing a rejected promise. The real router wraps
// every handler in an async fn that normalises this; the fake test router does
// not, so capture both throw shapes.
export const captureThrow = async (run: () => unknown): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the handler to throw');
};
