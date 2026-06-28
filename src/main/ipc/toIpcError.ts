import { isMinecraftKitError } from '@loontail/minecraft-kit';
import { ERROR_CODES } from '@shared/constants';
import type { IpcError } from '@shared/ipc';
import { app } from 'electron';

// Stack traces leak source paths — surface only in dev.
const isDev = (): boolean => !app.isPackaged;

type CodedError = Error & { code: string };

// Domain errors carry a string `code`. JSON.stringify of an Error omits the
// non-enumerable `message`, so the boundary copies code+message onto a fresh
// plain object rather than casting.
const isCodedError = (error: unknown): error is CodedError =>
  error instanceof Error && typeof (error as { code?: unknown }).code === 'string';

// Node fs/net failures also carry a string `code`, but their `message` embeds
// absolute paths. Detect them by errno/syscall so they take the generic
// handler-failed path instead of leaking OS codes and user paths across the bridge.
const isNodeErrnoException = (error: Error): boolean => {
  const errno = error as NodeJS.ErrnoException;
  return typeof errno.syscall === 'string' || typeof errno.errno === 'number';
};

const isIpcErrorShape = (error: unknown): error is IpcError =>
  typeof error === 'object' &&
  error !== null &&
  typeof (error as { code?: unknown }).code === 'string' &&
  typeof (error as { message?: unknown }).message === 'string';

const devDetailsForError = (error: Error): Record<string, unknown> | undefined => {
  if (!isDev()) return undefined;
  const details: Record<string, unknown> = {};
  if (error.stack) details.stack = error.stack;
  if (isMinecraftKitError(error)) {
    details.kitCode = error.code;
    if (error.context !== undefined) details.kitContext = error.context;
  }
  return Object.keys(details).length > 0 ? details : undefined;
};

const build = (code: string, message: string, details?: unknown): IpcError =>
  details === undefined ? { code, message } : { code, message, details };

// Turns any thrown value into the structured IpcError that crosses the bridge.
// Order matters: kit errors expose their code/context only as dev details; Node
// errno errors collapse to a generic code so their path-bearing message never
// reaches the renderer; domain and already-structured errors keep their codes.
export const toIpcError = (error: unknown): IpcError => {
  if (isMinecraftKitError(error)) {
    return build(ERROR_CODES.IpcHandlerFailed, error.message, devDetailsForError(error));
  }
  if (error instanceof Error && isNodeErrnoException(error)) {
    return build(ERROR_CODES.IpcHandlerFailed, 'Operation failed', devDetailsForError(error));
  }
  if (isCodedError(error)) {
    return build(error.code, error.message, devDetailsForError(error));
  }
  if (isIpcErrorShape(error)) {
    return build(error.code, error.message, error.details);
  }
  if (error instanceof Error) {
    return build(ERROR_CODES.IpcHandlerFailed, error.message, devDetailsForError(error));
  }
  return build(ERROR_CODES.Unknown, 'Unknown error', isDev() ? { error } : undefined);
};
