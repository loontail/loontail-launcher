import { scopedLogger } from '@main/infra/logger';
import { ERROR_CODES } from '@shared/constants';
import {
  IPC_ERROR_SENTINEL,
  type IpcArgs,
  type IpcContract,
  type IpcError,
  type IpcResult,
} from '@shared/ipc';
import { type IpcMainInvokeEvent, ipcMain } from 'electron';
import { toIpcError } from './toIpcError';

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

// Electron's IPC drops the structure of any thrown value other than an Error
// and just forwards `String(value)` ("[object Object]"). Wrap the IpcError in
// an Error and tag the message with the shared sentinel so the preload can
// recognise and rehydrate it into a structured `{code, message, details}`.
const wrapForTransport = (ipcError: IpcError): Error =>
  new Error(`${IPC_ERROR_SENTINEL}${JSON.stringify(ipcError)}`);

export const createRouter = (isTrustedSender: SenderValidator): Router => {
  const registered: Array<keyof IpcContract> = [];

  const handle = <TChannel extends keyof IpcContract>(
    channel: TChannel,
    handler: Handler<TChannel>,
  ): void => {
    ipcMain.handle(channel, async (event, rawArgs: unknown) => {
      try {
        if (!isTrustedSender(event)) {
          const untrusted: IpcError = {
            code: ERROR_CODES.IpcUntrustedSender,
            message: 'Sender frame is not trusted',
          };
          throw untrusted;
        }
        const result = await handler(rawArgs as IpcArgs<TChannel>, event);
        return result;
      } catch (error) {
        const ipcError = toIpcError(error);
        logger.error(`Channel ${channel} failed`, ipcError);
        throw wrapForTransport(ipcError);
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
