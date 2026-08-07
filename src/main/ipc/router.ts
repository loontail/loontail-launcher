import { scopedLogger } from '@main/infra/logger';
import { ERROR_CODES } from '@shared/constants';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { MinecraftErrorCodes } from '@shared/contracts/minecraft';
import {
  IPC_ERROR_SENTINEL,
  type IpcArgs,
  type IpcContract,
  type IpcError,
  type IpcResult,
} from '@shared/ipc';
import { type IpcMainInvokeEvent, ipcMain } from 'electron';
import { assertNoIpcArgs } from './parseArgs';
import { toIpcError } from './toIpcError';

type Handler<TChannel extends keyof IpcContract> = (
  args: IpcArgs<TChannel>,
  event: IpcMainInvokeEvent,
) => Promise<IpcResult<TChannel>> | IpcResult<TChannel>;

export type SenderValidator = (event: IpcMainInvokeEvent, channel: keyof IpcContract) => boolean;

type NoArgsHandler<TChannel extends keyof IpcContract> = () =>
  | Promise<IpcResult<TChannel>>
  | IpcResult<TChannel>;

export type Router = {
  handle: <TChannel extends keyof IpcContract>(
    channel: TChannel,
    handler: Handler<TChannel>,
  ) => void;
  // For the ~20 channels that take no arguments. The rejection message is derived
  // from the channel, so it can never name a channel it did not reject.
  handleNoArgs: <TChannel extends keyof IpcContract>(
    channel: TChannel,
    handler: NoArgsHandler<TChannel>,
  ) => void;
  dispose: () => void;
};

const logger = scopedLogger('ipc');

// Expected, recovered-from failures (untrusted sender, invalid args, double-click
// OP_IN_FLIGHT, user ABORTED) log at warn so logger.error stays a signal for
// genuine unrecovered handler crashes (code-guideline §9).
const RECOVERABLE_CODES: ReadonlySet<string> = new Set<string>([
  ERROR_CODES.IPC_UNTRUSTED_SENDER,
  ERROR_CODES.IPC_INVALID_ARGS,
  MinecraftErrorCodes.OP_IN_FLIGHT,
  MinecraftErrorCodes.ABORTED,
  BundleErrorCodes.OP_IN_FLIGHT,
  BundleErrorCodes.ABORTED,
]);

const logIpcError = (channel: keyof IpcContract, ipcError: IpcError): void => {
  const message = `Channel ${channel} failed`;
  if (RECOVERABLE_CODES.has(ipcError.code)) {
    logger.warn(message, ipcError);
  } else {
    logger.error(message, ipcError);
  }
};

// Electron's IPC forwards `String(value)` for any non-Error thrown value, so the
// IpcError is wrapped in an Error tagged with the shared sentinel for the preload
// to rehydrate into a structured `{code, message, details}`.
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
        if (!isTrustedSender(event, channel)) {
          const untrusted: IpcError = {
            code: ERROR_CODES.IPC_UNTRUSTED_SENDER,
            message: 'Sender frame is not trusted',
          };
          throw untrusted;
        }
        const result = await handler(rawArgs as IpcArgs<TChannel>, event);
        return result;
      } catch (error) {
        const ipcError = toIpcError(error);
        logIpcError(channel, ipcError);
        throw wrapForTransport(ipcError);
      }
    });
    registered.push(channel);
  };

  const handleNoArgs = <TChannel extends keyof IpcContract>(
    channel: TChannel,
    handler: NoArgsHandler<TChannel>,
  ): void => {
    handle(channel, (rawArgs) => {
      assertNoIpcArgs(rawArgs, `${channel} takes no arguments`);
      return handler();
    });
  };

  const dispose = (): void => {
    for (const channel of registered) {
      ipcMain.removeHandler(channel);
    }
    registered.length = 0;
  };

  return { handle, handleNoArgs, dispose };
};
