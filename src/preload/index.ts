import type { IpcArgs, IpcContract, IpcEventPayloads, IpcResult } from '@shared/ipc';
import { type IpcRendererEvent, contextBridge, ipcRenderer } from 'electron';

type Unsubscribe = () => void;

const api = {
  invoke<TChannel extends keyof IpcContract>(
    channel: TChannel,
    args: IpcArgs<TChannel>,
  ): Promise<IpcResult<TChannel>> {
    return ipcRenderer.invoke(channel, args) as Promise<IpcResult<TChannel>>;
  },
  on<TEvent extends keyof IpcEventPayloads>(
    event: TEvent,
    callback: (payload: IpcEventPayloads[TEvent]) => void,
  ): Unsubscribe {
    const listener = (_event: IpcRendererEvent, payload: IpcEventPayloads[TEvent]): void => {
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
