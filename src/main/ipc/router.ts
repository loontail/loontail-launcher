import { isMinecraftKitError } from '@loontail/minecraft-kit';
import { scopedLogger } from '@main/infra/logger';
import { ERROR_CODES } from '@shared/constants';
import {
  IPC_ERROR_SENTINEL,
  type IpcArgs,
  type IpcContract,
  type IpcError,
  type IpcResult,
} from '@shared/ipc';
import { type IpcMainInvokeEvent, app, ipcMain } from 'electron';

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

// Stack traces leak source paths — surface only in dev.
const isDev = (): boolean => !app.isPackaged;

const devDetailsFor = (error: unknown): Record<string, unknown> | undefined => {
  if (!isDev()) return undefined;
  const details: Record<string, unknown> = {};
  if (error instanceof Error) {
    details.stack = error.stack;
  }
  if (isMinecraftKitError(error)) {
    details.kitCode = error.code;
    if (error.context !== undefined) details.kitContext = error.context;
  }
  return Object.keys(details).length > 0 ? details : undefined;
};

const normalizeError = (error: unknown): IpcError => {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    return error as IpcError;
  }
  if (error instanceof Error) {
    return toIpcError(ERROR_CODES.IpcHandlerFailed, error.message, devDetailsFor(error));
  }
  return toIpcError(ERROR_CODES.Unknown, 'Unknown error', isDev() ? { error } : undefined);
};

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
          throw toIpcError(ERROR_CODES.IpcUntrustedSender, 'Sender frame is not trusted');
        }
        const result = await handler(rawArgs as IpcArgs<TChannel>, event);
        return result;
      } catch (error) {
        const ipcError = normalizeError(error);
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
