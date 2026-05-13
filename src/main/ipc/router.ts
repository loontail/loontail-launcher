import { scopedLogger } from '@main/infra/logger';
import { ERROR_CODES } from '@shared/constants';
import type { IpcArgs, IpcContract, IpcError, IpcResult } from '@shared/ipc';
import { type IpcMainInvokeEvent, ipcMain } from 'electron';

type Handler<TChannel extends keyof IpcContract> = (
  args: IpcArgs<TChannel>,
  event: IpcMainInvokeEvent,
) => Promise<IpcResult<TChannel>> | IpcResult<TChannel>;

export type SenderValidator = (event: IpcMainInvokeEvent) => boolean;

export type Router = {
  handle: <TChannel extends keyof IpcContract>(
    channel: TChannel,
    handler: Handler<TChannel>,
  ) => void;
  dispose: () => void;
};

const logger = scopedLogger('ipc');

const toIpcError = (code: IpcError['code'], message: string, details?: unknown): IpcError =>
  details === undefined ? { code, message } : { code, message, details };

const normalizeError = (error: unknown): IpcError => {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    return error as IpcError;
  }
  if (error instanceof Error) {
    return toIpcError(ERROR_CODES.IpcHandlerFailed, error.message, { stack: error.stack });
  }
  return toIpcError(ERROR_CODES.Unknown, 'Unknown error', { error });
};

export const createRouter = (isTrustedSender: SenderValidator): Router => {
  const registered: Array<keyof IpcContract> = [];

  const handle = <TChannel extends keyof IpcContract>(
    channel: TChannel,
    handler: Handler<TChannel>,
  ): void => {
    ipcMain.handle(channel, async (event, rawArgs: unknown) => {
      try {
        if (!isTrustedSender(event)) {
          throw toIpcError(ERROR_CODES.IpcUntrustedSender, 'Sender frame is not trusted');
        }
        const result = await handler(rawArgs as IpcArgs<TChannel>, event);
        return result;
      } catch (error) {
        const ipcError = normalizeError(error);
        logger.error(`Channel ${channel} failed`, ipcError);
        throw ipcError;
      }
    });
    registered.push(channel);
  };

  const dispose = (): void => {
    for (const channel of registered) {
      ipcMain.removeHandler(channel);
    }
    registered.length = 0;
  };

  return { handle, dispose };
};
