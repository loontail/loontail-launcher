import { ERROR_CODES, type ErrorCode } from '@shared/constants/errorCodes';

export type IpcError = {
  code: ErrorCode;
  message: string;
  details?: unknown;
};

export const isIpcError = (value: unknown): value is IpcError => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    Object.values(ERROR_CODES).includes(candidate.code as ErrorCode)
  );
};

// Marker used by the main-process router to ship a structured IpcError
// through Electron's IPC, which otherwise drops everything but `Error.message`
// (a plain `{code,message}` throw round-trips as "[object Object]"). The
// preload's `invoke` looks for this sentinel in the rejection message and
// rehydrates the JSON payload back into a real `IpcError`.
export const IPC_ERROR_SENTINEL = '__LOONTAIL_IPC_ERROR__';

export const tryUnwrapIpcError = (raw: string): IpcError | null => {
  const idx = raw.indexOf(IPC_ERROR_SENTINEL);
  if (idx === -1) return null;
  const payload = raw.slice(idx + IPC_ERROR_SENTINEL.length);
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (isIpcError(parsed)) return parsed;
  } catch {
    // fall through
  }
  return null;
};
