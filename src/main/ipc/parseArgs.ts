import { ERROR_CODES } from '@shared/constants';
import type { IpcError } from '@shared/ipc';
import { app } from 'electron';
import type { infer as ZodInfer, ZodTypeAny } from 'zod';

export const KEY_REQUIRED_MSG = 'key must be a source-namespaced catalog key';

export const parseIpcArgs = <Schema extends ZodTypeAny>(
  schema: Schema,
  rawArgs: unknown,
  message: string,
): ZodInfer<Schema> => {
  const parsed = schema.safeParse(rawArgs);
  if (!parsed.success) {
    const error: IpcError = {
      code: ERROR_CODES.IpcInvalidArgs,
      message,
      ...(app.isPackaged ? {} : { details: parsed.error.format() }),
    };
    throw error;
  }
  return parsed.data;
};

export const assertNoIpcArgs = (rawArgs: unknown, message: string): void => {
  if (rawArgs === undefined) return;
  const error: IpcError = {
    code: ERROR_CODES.IpcInvalidArgs,
    message,
    ...(app.isPackaged ? {} : { details: { received: rawArgs } }),
  };
  throw error;
};
