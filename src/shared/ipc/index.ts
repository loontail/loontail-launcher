export { CONSOLE_TRUSTED_CHANNELS, IPC_CHANNELS, IPC_EVENTS } from './channels';
export type { IpcChannel, IpcEventName } from './channels';
export type {
  IpcArgs,
  IpcContract,
  IpcEventPayload,
  IpcEventPayloads,
  IpcResult,
  UpdaterStatusEvent,
} from './contract';
export { IPC_ERROR_SENTINEL, isIpcError, tryUnwrapIpcError } from './errors';
export type { IpcError } from './errors';
