import { ERROR_CODES } from '@shared/constants';
import type { IpcError } from '@shared/ipc';
import { app } from 'electron';
import type { infer as ZodInfer, ZodTypeAny } from 'zod';

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
