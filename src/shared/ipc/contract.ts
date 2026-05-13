export type IpcContract = {
  'app.getVersion': { args: undefined; result: string };
};

export type IpcArgs<TChannel extends keyof IpcContract> = IpcContract[TChannel]['args'];
export type IpcResult<TChannel extends keyof IpcContract> = IpcContract[TChannel]['result'];

export type IpcEventPayloads = Record<never, never>;

export type IpcEventPayload<E extends keyof IpcEventPayloads> = IpcEventPayloads[E];
