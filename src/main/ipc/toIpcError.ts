import { isMinecraftKitError } from '@loontail/minecraft-kit';
import { ERROR_CODES } from '@shared/constants';
import type { IpcError } from '@shared/ipc';
import { app } from 'electron';

// Stack traces leak source paths — surface only in dev.
const isDev = (): boolean => !app.isPackaged;

type CodedError = Error & { code: string };

// SkinError / ManagerError / BundleError all extend Error and carry a string
// `code`. JSON.stringify of an Error omits the non-enumerable `message`, so the
// boundary must copy code+message onto a fresh plain object rather than cast.
const isCodedError = (error: unknown): error is CodedError =>
  error instanceof Error && typeof (error as { code?: unknown }).code === 'string';

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

// Single boundary that turns any thrown value into the structured IpcError that
// crosses the bridge. Order matters: a kit error keeps a stable launcher code
// (its internal code/context surface only as dev details, never on the wire),
// domain errors (SkinError/ManagerError/BundleError) carry their own code
// through, an already-structured IpcError is preserved verbatim, and anything
// else collapses to a generic handler-failed / unknown code.
export const toIpcError = (error: unknown): IpcError => {
  if (isMinecraftKitError(error)) {
    return build(ERROR_CODES.IpcHandlerFailed, error.message, devDetailsForError(error));
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
