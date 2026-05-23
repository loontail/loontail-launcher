import {
  type IpcArgs,
  type IpcContract,
  type IpcEventPayloads,
  type IpcResult,
  tryUnwrapIpcError,
} from '@shared/ipc';
import { type IpcRendererEvent, contextBridge, ipcRenderer } from 'electron';

type Unsubscribe = () => void;

// Electron only ships `Error.message` across IPC, so the main-process router
// packs IpcError JSON inside `new Error(<sentinel><json>)`. Recover the
// structured payload here so renderer-side mutations reject with a proper
// `{code, message, details}` instead of an opaque
// `Error("Error invoking remote method ...: [object Object]")`.
const invokeWithStructuredErrors = async <TChannel extends keyof IpcContract>(
  channel: TChannel,
  args: IpcArgs<TChannel>,
): Promise<IpcResult<TChannel>> => {
  try {
    return (await ipcRenderer.invoke(channel, args)) as IpcResult<TChannel>;
  } catch (raw) {
    const message = raw instanceof Error ? raw.message : String(raw);
    const unwrapped = tryUnwrapIpcError(message);
    if (unwrapped !== null) throw unwrapped;
    throw raw;
  }
};

const api = {
  invoke: invokeWithStructuredErrors,
  on: <TEvent extends keyof IpcEventPayloads>(
    event: TEvent,
    callback: (payload: IpcEventPayloads[TEvent]) => void,
  ): Unsubscribe => {
    const listener = (_event: IpcRendererEvent, payload: IpcEventPayloads[TEvent]) => {
      callback(payload);
    };
    ipcRenderer.on(event, listener);
    return () => {
      ipcRenderer.removeListener(event, listener);
    };
  },
  platform: process.platform,
};

export type RendererApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
