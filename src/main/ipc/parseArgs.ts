import { ERROR_CODES } from '@shared/constants';
import type { IpcError } from '@shared/ipc';
import type { infer as ZodInfer, ZodTypeAny } from 'zod';

/**
 * Validate IPC handler arguments against a Zod schema.
 * On failure, throws a structured IpcError the router will surface to the
 * renderer — never lets a malformed payload reach the service layer.
 */
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
      details: parsed.error.format(),
    };
    throw error;
  }
  return parsed.data;
};
